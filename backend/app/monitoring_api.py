"""HTTP layer for the Monitoring tab, the risk model and the e-mail alerts.

build_router() receives the pieces that live in main.py (auth dependencies, grade helpers), so this module
never imports main and nothing existing had to change shape.

    GET  /api/monitoring/overview   safe-to-skip, AI risk, predicted GPA, alerts, sync info
    GET  /api/monitoring/alerts     the alert feed
    POST /api/predict/risk          risk + top-3 SHAP reasons for the signed-in student
    POST /api/simulate              "what if I skip N lectures / M practices"
    GET/PUT/DELETE /api/monitoring/curator   curator e-mail that receives the same alerts
    POST /api/monitoring/notify     send the risk e-mail now (also runs on a schedule)
    GET  /api/monitoring/model      model version and metrics
    GET  /api/teacher/monitoring/students   risk per student in the teacher's scope
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from . import monitoring as mon
from . import monitoring_store as store
from . import notify
from .ml import model as ml

log = logging.getLogger("studymate.monitoring")
ALERT_COOLDOWN = timedelta(hours=int(os.getenv("RISK_ALERT_COOLDOWN_HOURS", "24")))


class SimulateRequest(BaseModel):
    lectures: int = Field(default=0, ge=0, le=60)
    practices: int = Field(default=0, ge=0, le=60)
    course_code: Optional[str] = Field(default=None, max_length=40)
    max_hours: Optional[int] = Field(default=None, ge=1, le=60, description="Length of the returned curve in skipped hours")


class Reason(BaseModel):
    """One factor behind the risk score, explained with SHAP."""
    model_config = ConfigDict(extra="allow")
    feature: str = Field(examples=["pending_hours"])
    label: str
    value: float
    impact: float = Field(description="Percentage points of risk this factor adds (red) or removes (green)")
    text: str = Field(examples=["4 'Not submitted' hours that the teacher may still mark as absences, mostly in INF 451"])
    course: Optional[str] = None


class RiskResponse(BaseModel):
    """What the model says about the signed-in student."""
    model_config = ConfigDict(extra="allow")
    risk: float = Field(ge=0, le=1, description="Probability of being at risk (0-1)")
    risk_percent: int = Field(ge=0, le=100)
    level: str = Field(description="low (<25%), medium (<50%) or high (>=50%)", examples=["high"])
    summary: str = Field(description="The explanation in one or two sentences")
    predicted_gpa: float = Field(ge=0, le=4, description="SDU 4.0 scale: the real current GPA, lowered only by risk factors")
    gpa_basis: str = Field(description="'current' = anchored to the real GPA, 'model' = the model's own estimate")
    reasons: list[Reason] = Field(description="Top factors that push the risk up")
    helping: list[Reason] = Field(description="Top factors that keep the risk down")
    fx: bool = Field(description="True when a course has reached the 30% absence limit (FX): the risk is then at least 90%")
    model_version: str
    explainer: str = Field(description="'shap' (or 'occlusion' if SHAP is unavailable)")


class SimulationPoint(BaseModel):
    hours: int
    risk: float
    predicted_gpa: float
    fx: bool


class SimulateResponse(BaseModel):
    """Result of "what if I skip N lectures and M practices"."""
    model_config = ConfigDict(extra="allow")
    skipped_hours: float
    before: dict
    after: dict
    gpa_change: float
    risk_change: int
    fx_courses: list[str] = Field(description="Courses that would pass the 30% absence limit")
    curve: list[SimulationPoint] = Field(description="Risk and GPA after 0..N skipped hours (never improves)")
    message: str = Field(examples=["New predicted GPA: 3.4. Dropout risk: 15%."])


class CuratorRequest(BaseModel):
    email: str = Field(min_length=5, max_length=160, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: Optional[str] = Field(default=None, max_length=100)


# Wired once by build_router(); module-level so record_current_risk() (called after a sync) can reuse them
_env: dict = {}


def automatic_alerts_enabled() -> bool:
    return os.getenv("ALERTS_ENABLED", "1") != "0" and (
        notify.configured() or any(os.getenv(key) for key in (
            "MAILER_SECRET_KEY", "GMAIL_APP_PASSWORD", "SMTP_PASSWORD",
        ))
    )


def student_inputs(user_id: str, student_id: str) -> dict:
    """Everything the model needs for one student, from the local database (synced SDU data or seeded data)."""
    repo = _env["repo"]
    snap = repo.get_snapshot(user_id, "attendance_detail") or {}
    courses = mon.courses_from_rows(snap.get("rows") or [])
    source = "sdu_journal"
    grades = _env["grades"](student_id, user_id)                  # {"scores", "names", "trend"}
    if not courses:
        courses = mon.courses_from_sessions(repo.get_attendance_sessions(student_id), grades["names"],
                                            store.attendance_log(repo, student_id))
        source = "attendance_sessions"
    notes = repo.get_notifications(student_id)
    missed = max(repo.missing_assignments.get(student_id, 0), sum(n["type"] == "missed_deadline" for n in notes))
    features = mon.build_features(courses, grades["scores"], grades["trend"], missed, grades.get("gpa"))
    return {"courses": courses, "scores": grades["scores"], "trend": grades["trend"], "missed": missed, "gpa": grades.get("gpa"),
            "features": features, "source": source if courses else "none", "has_data": bool(courses or grades["scores"])}


def analyse(inputs: dict) -> dict:
    result = mon.add_course_detail(mon.score(inputs["features"]), inputs["courses"])
    return {"result": result, "alerts": mon.build_alerts(inputs["courses"], result, inputs["missed"])}


def _require_data(inputs: dict) -> None:
    if not inputs["has_data"]:
        raise HTTPException(status_code=409, detail="No attendance or grade data yet. Sync your SDU account first.")


def record_current_risk(user) -> Optional[dict]:
    """After a sync: remember the risk for the trend chart and send the e-mail alert when it is due."""
    inputs = student_inputs(user.id, user.student_id)
    if not inputs["has_data"]:
        return None
    analysis = analyse(inputs)
    result = analysis["result"]
    store.record_risk(_env["repo"], user.student_id, result["risk"], result["predicted_gpa"])
    if automatic_alerts_enabled():
        threading.Thread(target=send_risk_alert, args=(user.id, user.student_id, user.name), daemon=True).start()
    return analysis


def send_risk_alert(user_id: str, student_id: str, name: str) -> dict:
    """E-mail the student (and the curator, when one is set) if the risk is above the threshold."""
    repo = _env["repo"]
    inputs = student_inputs(user_id, student_id)
    if not inputs["has_data"]:
        return {"sent": False, "reason": "no data"}
    analysis = analyse(inputs)
    result, risk = analysis["result"], analysis["result"]["risk"]
    threshold = notify.threshold()
    if risk <= threshold:
        return {"sent": False, "reason": f"risk {result['risk_percent']}% must exceed {threshold:.0%}",
                "risk_percent": result["risk_percent"]}
    previous = store.last_alert(repo, student_id)
    if previous:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(previous["sent_at"])
        if age < ALERT_COOLDOWN and risk < previous["risk"] + 0.15:
            return {"sent": False, "reason": "already alerted recently", "risk_percent": result["risk_percent"]}
    sender = notify.send_resend if notify.configured() else _env["fallback_sender"]
    recipients = []
    email = repo.get_email_for_user(user_id)
    if email:
        recipients.append((email, False))
    curator = store.get_curator(repo, student_id)
    if curator and curator["email"].casefold() != (email or "").casefold():
        recipients.append((curator["email"], True))
    sent_to, errors = [], []
    for address, for_curator in recipients:
        subject, text, html_body = notify.risk_email(name, result, analysis["alerts"], for_curator)
        ok, reason = (sender(address, subject, text, html_body) if sender is notify.send_resend
                      else sender(address, subject, text))
        (sent_to if ok else errors).append(address if ok else f"{address}: {reason}")
    if sent_to:
        store.record_alert(repo, student_id, risk)
        repo.add_notification(student_id, "risk_alert", "High academic risk",
                              f"The risk model predicts {result['risk_percent']}% risk. See the Monitoring tab.", None)
    return {"sent": bool(sent_to), "to": [a for a in sent_to], "errors": errors, "risk_percent": result["risk_percent"],
            "reason": None if sent_to else (errors[0] if errors else "no e-mail address on file")}


def run_scheduled_alerts() -> dict:
    """Background job: check every student and send the alerts that are due."""
    repo = _env["repo"]
    with repo.connect() as db:
        students = [dict(r) for r in db.execute(
            "SELECT id, name, student_id FROM users WHERE role = 'student' AND student_id IS NOT NULL")]
    sent = 0
    for s in students:
        try:
            sent += bool(send_risk_alert(s["id"], s["student_id"], s["name"]).get("sent"))
        except Exception:
            log.exception("risk alert failed for %s", s["student_id"])
    log.info("risk alert run: %d e-mail(s) for %d student(s)", sent, len(students))
    return {"students": len(students), "sent": sent}


def warm_up_model() -> None:
    """Load the model and SHAP in the background when the server starts.

    The first prediction otherwise pays for importing scikit-learn/SHAP and building the explainer
    (seconds on a laptop), which made the first sync or the first Overview feel slow."""
    def work() -> None:
        try:
            ml.load()
            ml.predict({})            # builds the SHAP explainer too
        except Exception:
            log.exception("model warm-up failed (it will load on first use instead)")
    threading.Thread(target=work, name="model-warm-up", daemon=True).start()


_scheduler = None


def start_scheduler() -> None:
    """Run periodic alerts when a mail provider is configured and alerts are enabled."""
    global _scheduler
    if _scheduler or not automatic_alerts_enabled():
        return
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    minutes = max(5, int(os.getenv("ALERT_INTERVAL_MINUTES", "360")))
    _scheduler.add_job(run_scheduled_alerts, "interval", minutes=minutes, id="risk-alerts",
                       next_run_time=datetime.now(timezone.utc) + timedelta(minutes=2))
    _scheduler.start()
    log.info("risk e-mail alerts scheduled every %d minutes", minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def build_router(*, repo, current_user: Callable, require_role: Callable, grades: Callable,
                 last_synced: Callable, fallback_sender: Callable, teacher_scope: Callable, user_for_student: Callable) -> APIRouter:
    """grades(student_id, user_id) -> {"scores", "names", "trend"}; last_synced(user_id) -> iso string or None."""
    _env.update(repo=repo, grades=grades, fallback_sender=fallback_sender)
    store.ensure(repo)
    # Registers the "Authorize" button in /docs (paste the access_token); real checking stays in current_user
    router = APIRouter(on_startup=[warm_up_model, start_scheduler], on_shutdown=[stop_scheduler], tags=["Monitoring & AI"],
                       dependencies=[Security(HTTPBearer(auto_error=False))])
    student = Depends(require_role("student"))

    @router.get("/api/monitoring/overview", summary="Everything the Monitoring tab shows")
    def overview(user=student):
        inputs = student_inputs(user.id, user.student_id)
        base = {"has_data": inputs["has_data"], "data_source": inputs["source"], "last_synced": last_synced(user.id),
                "model": {"version": ml.info()["version"]}}
        if not inputs["has_data"]:
            return {**base, "safe_to_skip": mon.safe_to_skip([]), "risk": None, "alerts": [], "history": []}
        analysis = analyse(inputs)
        store.record_risk(repo, user.student_id, analysis["result"]["risk"], analysis["result"]["predicted_gpa"]) \
            if not store.risk_history(repo, user.student_id, 1) else None
        return {**base, "safe_to_skip": mon.safe_to_skip(inputs["courses"]), "risk": analysis["result"],
                "alerts": analysis["alerts"], "features": inputs["features"],
                "history": store.risk_history(repo, user.student_id)}

    @router.get("/api/monitoring/alerts")
    def alerts(user=student):
        inputs = student_inputs(user.id, user.student_id)
        if not inputs["has_data"]:
            return {"items": []}
        return {"items": analyse(inputs)["alerts"]}

    @router.post("/api/predict/risk", response_model=RiskResponse, summary="Predict the student's academic risk",
                 description="Runs the signed-in student's synced attendance, grades and deadlines through the trained "
                             "RandomForest and explains the score with SHAP (top reasons that raise or lower the risk). "
                             "Returns 409 until the student has synced some data.")
    def predict_risk(user=student):
        inputs = student_inputs(user.id, user.student_id)
        _require_data(inputs)
        analysis = analyse(inputs)
        store.record_risk(repo, user.student_id, analysis["result"]["risk"], analysis["result"]["predicted_gpa"])
        return {**analysis["result"], "features": inputs["features"], "data_source": inputs["source"]}

    @router.post("/api/simulate", response_model=SimulateResponse, summary="What if I skip some classes?",
                 description="Adds the skipped lectures and practices to the student's absences, re-runs the model and "
                             "returns the new predicted GPA and risk, plus a curve for 0..N skipped hours.")
    def simulate(req: SimulateRequest, user=student):
        inputs = student_inputs(user.id, user.student_id)
        _require_data(inputs)
        if not inputs["courses"]:
            raise HTTPException(status_code=409, detail="No class-hour data to simulate on. Sync your SDU account first.")
        if req.course_code and req.course_code not in [c["code"] for c in inputs["courses"]]:
            raise HTTPException(status_code=404, detail="Unknown course.")
        return mon.simulate(inputs["courses"], inputs["scores"], inputs["trend"], inputs["missed"],
                            req.lectures, req.practices, req.course_code, current_gpa=inputs.get("gpa"),
                            max_hours=req.max_hours)

    @router.get("/api/monitoring/curator")
    def get_curator(user=student):
        return store.get_curator(repo, user.student_id) or {"email": None, "name": None}

    @router.put("/api/monitoring/curator")
    def put_curator(req: CuratorRequest, user=student):
        store.set_curator(repo, user.student_id, req.email.strip(), req.name)
        return {"ok": True, "email": req.email.strip(), "name": req.name}

    @router.delete("/api/monitoring/curator")
    def remove_curator(user=student):
        store.delete_curator(repo, user.student_id)
        return {"ok": True}

    @router.post("/api/monitoring/notify")
    def notify_now(user=student):
        return send_risk_alert(user.id, user.student_id, user.name)

    @router.get("/api/monitoring/model")
    def model_info(user=Depends(current_user)):
        return ml.info()

    @router.get("/api/teacher/monitoring/students")
    def teacher_risk(user=Depends(require_role("teacher"))):
        rows = []
        for sid in sorted(teacher_scope(user)):
            owner = user_for_student(sid)
            if not owner:
                continue
            inputs = student_inputs(owner["id"], sid)
            if not inputs["has_data"]:
                continue
            analysis = analyse(inputs)
            r = analysis["result"]
            rows.append({"student_id": sid, "name": owner["name"], "risk_percent": r["risk_percent"], "level": r["level"],
                         "predicted_gpa": r["predicted_gpa"], "reasons": r["reasons"], "fx": r["fx"],
                         "pending_hours": inputs["features"].get("pending_hours", 0)})
        rows.sort(key=lambda x: -x["risk_percent"])
        return {"items": rows, "needs_support": sum(x["risk_percent"] >= 50 for x in rows)}

    return router
