"""Monitoring logic: Safe-to-Skip calculator, AI risk scoring, what-if simulation and alerts.

Pure functions over plain dicts, so everything is easy to test. The HTTP layer is monitoring_api.py.

A "course" here is {code, name, hours, present, absent, permitted, pending, remaining}:
  hours     all class hours scheduled this term
  absent    hours the teacher marked as missed
  pending   "Not submitted": held, but not marked yet (neither attendance nor absence)
  remaining hours still ahead
SDU rule (same as goals.py): a course ends in FX once absences reach 30% of its hours, so the
most hours a student may miss is ceil(hours * 30%) - 1.
"""
from __future__ import annotations

import math
import os
from typing import Optional

from .ml import model as ml
from .ml.features import ABSENCE_LIMIT_PCT, describe, risk_level, summarize

EPS = 1e-9
WARN_BUFFER = 2                       # this many hours (or fewer) left before FX -> yellow
HOURS_PER_CLASS = {                   # class hours one skipped lecture / practice costs
    "lecture": float(os.getenv("LECTURE_HOURS", "1")),
    "practice": float(os.getenv("PRACTICE_HOURS", "1")),
}


def _num(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


# ─── courses ───────────────────────────────────────────────────────

def courses_from_rows(rows: list[dict]) -> list[dict]:
    """Normalise SDU attendance_detail rows (journal counts) into course dicts; rows without hour counts are skipped."""
    courses = []
    for row in rows or []:
        hours, absent = _num(row.get("hours")), _num(row.get("absent"))
        if not hours or hours <= 0 or absent is None:
            continue
        present = _num(row.get("present")) or 0.0
        permitted = _num(row.get("permitted")) or 0.0
        pending = _num(row.get("pending")) or 0.0
        remaining = _num(row.get("remaining"))
        if remaining is None:
            remaining = max(0.0, hours - present - absent - permitted - pending)
        courses.append({
            "code": str(row.get("course_code") or row.get("lesson") or "").strip(),
            "name": row.get("lesson") or row.get("course_code") or "Course",
            "hours": hours, "present": present, "absent": absent, "permitted": permitted,
            "pending": pending, "remaining": remaining,
        })
    return courses


def courses_from_sessions(sessions: list[dict], names: Optional[dict] = None, log: Optional[list[dict]] = None) -> list[dict]:
    """Fallback for locally stored attendance (present/excused/absent per session); `log` adds pending hours."""
    names = names or {}
    by_code: dict[str, dict] = {}
    for s in sessions or []:
        c = by_code.setdefault(s["course_code"], {"present": 0, "absent": 0, "permitted": 0, "pending": 0})
        key = {"present": "present", "excused": "permitted", "absent": "absent"}.get(s["status"])
        if key:
            c[key] += 1
    for entry in log or []:
        if entry.get("status") == "pending" and entry["course_code"] in by_code:
            by_code[entry["course_code"]]["pending"] += 1
    return [{"code": code, "name": names.get(code, code),
             "hours": c["present"] + c["absent"] + c["permitted"] + c["pending"], "remaining": 0.0, **c}
            for code, c in by_code.items() if c["present"] + c["absent"] + c["permitted"] + c["pending"] > 0]


# ─── Safe-to-Skip ──────────────────────────────────────────────────

def absence_limit(hours: float) -> int:
    """Most hours that can be missed while staying under 30% (reaching it means FX)."""
    return max(0, math.ceil(hours * ABSENCE_LIMIT_PCT / 100.0 - EPS) - 1)


def course_status(course: dict) -> dict:
    limit = absence_limit(course["hours"])
    absent, pending = course["absent"], course["pending"]
    left = limit - absent                               # hours that can still be skipped
    left_if_pending = left - pending                    # ...if every "Not submitted" hour becomes an absence
    if left < 0:
        level = "danger"
    elif left_if_pending <= 0:
        level = "danger" if left_if_pending < 0 else "warning"
    elif left <= WARN_BUFFER or left_if_pending <= WARN_BUFFER:
        level = "warning"
    else:
        level = "safe"
    return {
        "code": course["code"], "name": course["name"], "hours": _int(course["hours"]),
        "limit": limit, "absent": _int(absent), "pending": _int(pending), "permitted": _int(course["permitted"]),
        "remaining_skips": max(0, _int(left)), "remaining_if_pending_absent": _int(left_if_pending),
        "absence_pct": round(absent / course["hours"] * 100, 1),
        "used_pct": min(100, round(absent / limit * 100)) if limit else (100 if absent else 0),
        "level": level, "fx": left < 0,
        # A course with few class hours has a small allowance, so each missed hour costs a larger share of it
        "weekly_hours": round(course["hours"] / TERM_WEEKS, 1),
        "cost_per_hour_pct": round(100 / limit) if limit else 100,
    }


def _int(value: float):
    return int(value) if float(value).is_integer() else round(value, 1)


def safe_to_skip(courses: list[dict]) -> dict:
    items = sorted((course_status(c) for c in courses), key=lambda c: (c["remaining_skips"], c["code"]))
    total_left = sum(c["remaining_skips"] for c in items)
    worst = "danger" if any(c["level"] == "danger" for c in items) else \
            "warning" if any(c["level"] == "warning" for c in items) else "safe"
    return {"items": items, "level": worst if items else "unknown", "total_remaining_skips": total_left,
            "rule": f"A course ends in FX at {ABSENCE_LIMIT_PCT:.0f}% absence (attendance below 70%)."}


# ─── features + risk ───────────────────────────────────────────────

def attendance_features(courses: list[dict]) -> dict:
    if not courses:
        return {}
    conducted = sum(c["present"] + c["absent"] + c["permitted"] for c in courses)
    absent = sum(c["absent"] for c in courses)
    attended = sum(c["present"] + c["permitted"] for c in courses)
    return {
        "attendance_pct": round(attended / conducted * 100, 2) if conducted else 100.0,
        "max_absence_pct": round(max(c["absent"] / c["hours"] * 100 for c in courses), 2),
        "absent_hours": absent,
        "pending_hours": sum(c["pending"] for c in courses),
    }


def grade_features(scores: list[float], trend: Optional[float]) -> dict:
    out = {"grade_trend": trend or 0.0}
    if scores:
        out.update(avg_grade=sum(scores) / len(scores), min_grade=min(scores),
                   low_grade_courses=sum(s < 60 for s in scores))
    return out


PENDING_WEIGHT = 0.5      # a "Not submitted" hour counts as half an absence: it may still be marked absent
TERM_WEEKS = 15           # an SDU term is about 15 weeks: class hours / 15 = hours a week


def course_pressures(courses: list[dict]) -> list[float]:
    """Per course: the share of its allowed absences already used (1.0 = the FX limit is reached).

    A course with few class hours has a small allowance, so one missed hour is a big share of it; a course with
    several lessons a week can absorb more. This is SDU's own rule, not a learned pattern: the public data the model
    was trained on says almost nothing about absences, so the effect of absences is applied here, in the open."""
    out = []
    for c in courses:
        limit = absence_limit(c["hours"])
        used = c["absent"] + PENDING_WEIGHT * c["pending"]
        out.append(round(min(used / limit if limit else (1.25 if used > 0 else 0.0), 1.25), 4))
    return out


def attendance_pressure(courses: list[dict]) -> float:
    """The worst course's pressure (used for the explanation)."""
    return max(course_pressures(courses), default=0.0)


def _pressure_effect(pressures: list[float]) -> tuple[float, float]:
    """(extra risk, GPA points lost) over all courses: smooth and rising, a jump at FX, and several courses add up.

    The worst course counts in full and every other course adds a quarter (risk) or a half (GPA) of its own effect."""
    risks, pens = [], []
    for p in pressures:
        q = min(max(p, 0.0), 1.0)
        risks.append(0.85 * q ** 1.5)
        pens.append(0.9 if p > 1.0 else 0.6 * q ** 1.5)
    if not risks:
        return 0.0, 0.0
    extra = min(0.95, max(risks) + 0.25 * (sum(risks) - max(risks)))
    return extra, min(1.8, max(pens) + 0.5 * (sum(pens) - max(pens)))


def apply_attendance_rules(risk: float, gpa: float, features: dict) -> tuple[float, float]:
    """Combine the model's risk and GPA with the absence rule (independent risks: 1 - (1 - a)(1 - b))."""
    pressures = features.get("course_pressures") or [features.get("attendance_pressure") or 0.0]
    extra_risk, penalty = _pressure_effect(pressures)
    return 1 - (1 - risk) * (1 - extra_risk), max(0.0, gpa - penalty)


def build_features(courses: list[dict], scores: list[float], trend: Optional[float], missed_deadlines: int,
                   current_gpa: Optional[float] = None) -> dict:
    out = {**attendance_features(courses), **grade_features(scores, trend), "missed_deadlines": float(missed_deadlines or 0)}
    if courses:
        out["course_pressures"] = course_pressures(courses)         # not model inputs: they drive the absence rule
        out["attendance_pressure"] = max(out["course_pressures"], default=0.0)
    if current_gpa is not None:
        out["current_gpa"] = float(current_gpa)        # not a model input: the anchor for the predicted GPA
    return out


def score(features: dict) -> dict:
    """Model prediction plus the deterministic SDU rule: reaching the absence limit is FX, whatever the model says."""
    result = ml.predict(features)
    pressure = features.get("attendance_pressure") or 0.0
    if pressure > 0:
        risk, gpa = apply_attendance_rules(result["risk"], result["predicted_gpa"], features)
        delta = risk - result["risk"]
        result.update(risk=round(risk, 4), risk_percent=round(risk * 100), level=risk_level(risk), predicted_gpa=round(gpa, 2))
        if delta >= 0.02:
            used = round(min(pressure, 1.0) * 100)
            result["reasons"] = sorted([*result["reasons"], {
                "feature": "attendance_pressure", "label": "Absence limit used", "value": used,
                "impact": round(delta * 100, 1),
                "text": f"You have used {used}% of the absences allowed before FX ('Not submitted' hours count as half)"}],
                key=lambda r: -r["impact"])[:3]
        if pressure >= 0.3:
            result["helping"] = [h for h in result["helping"] if h["feature"] not in ("attendance_pct", "max_absence_pct", "absent_hours")]
    if features.get("max_absence_pct", 0) >= ABSENCE_LIMIT_PCT:
        result["fx"] = True
        result["risk"] = max(result["risk"], 0.9)
        result["risk_percent"] = round(result["risk"] * 100)
        result["level"] = risk_level(result["risk"])
        if not any(r["feature"] == "max_absence_pct" for r in result["reasons"]):
            result["reasons"] = [{"feature": "max_absence_pct", "label": "Highest course absence",
                                  "value": features["max_absence_pct"], "impact": 0.0,
                                  "text": describe("max_absence_pct", features["max_absence_pct"], True)},
                                 *result["reasons"]][:3]
        result["helping"] = [h for h in result["helping"] if h["feature"] not in ("attendance_pct", "max_absence_pct", "absent_hours")]
    else:
        result["fx"] = False
    result["summary"] = summarize(result["risk_percent"], result["level"], result["reasons"], result["helping"])
    return result


def add_course_detail(result: dict, courses: list[dict]) -> dict:
    """Say which course drives a reason, e.g. "4 'Not submitted' hours in INF 451"."""
    for reason in result["reasons"]:
        key = {"pending_hours": "pending", "absent_hours": "absent"}.get(reason["feature"])
        if key and courses:
            top = max(courses, key=lambda c: c[key])
            if top[key] > 0:
                reason["course"] = top["code"] or top["name"]
                reason["text"] += f", mostly in {reason['course']}"
        elif reason["feature"] == "max_absence_pct" and courses:
            top = max(courses, key=lambda c: c["absent"] / c["hours"])
            reason["course"] = top["code"] or top["name"]
            reason["text"] += f" in {reason['course']}"
    result["summary"] = summarize(result["risk_percent"], result["level"], result["reasons"], result["helping"])   # now names the course
    return result


# ─── what-if simulation ────────────────────────────────────────────

def _apply_skips(courses: list[dict], hours: float, course_code: Optional[str]) -> list[dict]:
    """Copy of the courses with `hours` more absences: all on one course, or spread over all of them."""
    out = [dict(c) for c in courses]
    if not out or hours <= 0:
        return out
    targets = [c for c in out if c["code"] == course_code] if course_code else out
    if not targets:
        return out
    share, extra = divmod(int(round(hours)), len(targets))
    for i, c in enumerate(targets):
        c["absent"] += share + (1 if i < extra else 0)
    return out


def simulate(courses: list[dict], scores: list[float], trend: Optional[float], missed: int,
             lectures: int, practices: int, course_code: Optional[str] = None, curve_points: int = 10,
             current_gpa: Optional[float] = None, max_hours: Optional[int] = None) -> dict:
    hours = lectures * HOURS_PER_CLASS["lecture"] + practices * HOURS_PER_CLASS["practice"]
    now_features = build_features(courses, scores, trend, missed, current_gpa)
    before = score(now_features)
    after_courses = _apply_skips(courses, hours, course_code)
    after_features = build_features(after_courses, scores, trend, missed, current_gpa)
    after = add_course_detail(score(after_features), after_courses)
    # Skipping classes can never make things better: the model is not monotonic at low risk, so cap it
    after["risk"] = max(after["risk"], before["risk"])
    after["risk_percent"] = round(after["risk"] * 100)
    after["level"] = risk_level(after["risk"])
    after["predicted_gpa"] = min(after["predicted_gpa"], before["predicted_gpa"])
    status_after = safe_to_skip(after_courses)
    fx_courses = [c["code"] or c["name"] for c in status_after["items"] if c["fx"]]
    newly_fx = [c for c in fx_courses if c not in [s["code"] or s["name"] for s in safe_to_skip(courses)["items"] if s["fx"]]]

    # Curve: risk and GPA for 0..N skipped hours on the same target, to draw the drop
    steps = max_hours if max_hours else max(curve_points, int(math.ceil(hours)) + 2)
    curve_courses = [_apply_skips(courses, h, course_code) for h in range(steps + 1)]
    feats = [build_features(cs, scores, trend, missed, current_gpa) for cs in curve_courses]
    predictions = ml.predict_many(feats)                                    # one batch instead of one call per point
    curve = []
    floor_risk, ceiling_gpa = before["risk"], before["predicted_gpa"]      # every point starts from today's values
    for h, (cs, f, raw) in enumerate(zip(curve_courses, feats, predictions)):
        guard = f.get("max_absence_pct", 0) >= ABSENCE_LIMIT_PCT
        r, g = apply_attendance_rules(*raw, f)
        floor_risk = max(floor_risk, 0.9 if guard else r)                   # only ever rises with more skipped hours
        ceiling_gpa = min(ceiling_gpa, g)                                   # only ever falls
        curve.append({"hours": h, "risk": round(floor_risk, 4), "predicted_gpa": round(ceiling_gpa, 2), "fx": guard,
                      "fx_courses": [c["code"] or c["name"] for c in safe_to_skip(cs)["items"] if c["fx"]]})
    target = [course_status(c) for c in courses if not course_code or c["code"] == course_code]
    most_sensitive = min(target, key=lambda c: c["limit"]) if target else None     # smallest allowance = highest cost per hour
    course_cost = {k: most_sensitive[k] for k in ("code", "name", "hours", "weekly_hours", "limit", "cost_per_hour_pct")} if most_sensitive else None
    return {
        "skipped_hours": _int(hours), "lectures": lectures, "practices": practices, "course": course_code,
        "before": _brief(before), "after": _brief(after),
        "gpa_change": round(after["predicted_gpa"] - before["predicted_gpa"], 2),
        "risk_change": after["risk_percent"] - before["risk_percent"],
        "fx_courses": fx_courses, "newly_fx_courses": newly_fx,
        "safe_to_skip": status_after, "reasons": after["reasons"], "curve": curve,
        "course_cost": course_cost, "hours_per_class": dict(HOURS_PER_CLASS),
        "message": _sim_message(after, hours, fx_courses),
    }


def _brief(r: dict) -> dict:
    return {k: r[k] for k in ("risk", "risk_percent", "level", "predicted_gpa", "fx")}


def _sim_message(after: dict, hours: float, fx_courses: list[str]) -> str:
    gpa = math.floor(after["predicted_gpa"] * 10 + 0.5) / 10          # round half up, like the screen does
    base = f"New predicted GPA: {gpa:.1f}. Dropout risk: {after['risk_percent']}%."
    if fx_courses:
        return f"Skipping {_int(hours)} hour(s) puts {', '.join(fx_courses)} over the 30% absence limit (FX). " + base
    return base


# ─── alerts ────────────────────────────────────────────────────────

def build_alerts(courses: list[dict], result: Optional[dict], missed_deadlines: int = 0) -> list[dict]:
    """Warning feed, most severe first. severity: critical > high > medium > info."""
    alerts = []
    for c in courses:
        s = course_status(c)
        label = c["code"] or c["name"]
        if s["fx"]:
            alerts.append({"severity": "critical", "type": "fx", "course": label,
                           "title": f"{label}: absence limit exceeded",
                           "detail": f"You missed {s['absent']} hours; the limit is {s['limit']}. The course is at FX risk. "
                                     "Contact your instructor now."})
        elif c["pending"] > 0:
            n = _int(c["pending"])
            if s["remaining_if_pending_absent"] < 0:
                alerts.append({"severity": "high", "type": "pending_over_limit", "course": label,
                               "title": f"{label}: {n} 'Not submitted' could push you over the limit",
                               "detail": f"Warning: you have {n} 'Not submitted' in {label}. If the professor marks them as "
                                         f"absences, you will exceed the limit ({s['absent'] + n} of {s['limit']} allowed hours)."})
            elif s["remaining_if_pending_absent"] <= WARN_BUFFER:
                alerts.append({"severity": "medium", "type": "pending_close", "course": label,
                               "title": f"{label}: {n} 'Not submitted' hours",
                               "detail": f"If the {n} unmarked hours become absences you will have only "
                                         f"{max(0, s['remaining_if_pending_absent'])} skip(s) left in {label}."})
            else:
                alerts.append({"severity": "info", "type": "pending", "course": label,
                               "title": f"{label}: {n} 'Not submitted' hours",
                               "detail": f"The teacher has not marked {n} past hour(s) yet. They are not absences for now."})
        elif s["level"] == "warning":
            alerts.append({"severity": "medium", "type": "close_to_limit", "course": label,
                           "title": f"{label}: only {s['remaining_skips']} skip(s) left",
                           "detail": f"You have missed {s['absent']} of {s['limit']} allowed hours."})
    if missed_deadlines:
        alerts.append({"severity": "high" if missed_deadlines >= 2 else "medium", "type": "deadlines", "course": None,
                       "title": f"{missed_deadlines} missed deadline{'s' if missed_deadlines != 1 else ''}",
                       "detail": "Missed deadlines lower your predicted GPA. Contact the instructor about late submission."})
    if result and result["risk"] >= 0.5:
        why = "; ".join(r["text"] for r in result["reasons"]) or "several factors"
        alerts.append({"severity": "high" if result["risk"] < 0.75 else "critical", "type": "ai_risk", "course": None,
                       "title": f"AI risk is {result['risk_percent']}%", "detail": f"Main reasons: {why}."})
    order = {"critical": 0, "high": 1, "medium": 2, "info": 3}
    return sorted(alerts, key=lambda a: order[a["severity"]])
