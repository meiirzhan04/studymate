"""Monitoring tab: pending ("Not submitted") status, risk model, SHAP reasons, simulation, alerts, e-mail."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import monitoring as mon
from app import monitoring_api, monitoring_store, notify, sdu_portal
from app.main import app, repo
from app.ml import dataset, model as ml
from app.ml.features import FEATURES

from test_portal import journal_section

client = TestClient(app)


def token(identifier="240103118", password="studymate2026"):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password}).json()["access_token"]


def auth(value): return {"Authorization": f"Bearer {value}"}


COURSES = [
    {"code": "INF 451", "name": "Databases", "hours": 30, "present": 12, "absent": 6, "permitted": 0, "pending": 4, "remaining": 8},
    {"code": "MAT 101", "name": "Math", "hours": 45, "present": 30, "absent": 2, "permitted": 1, "pending": 0, "remaining": 12},
]


# ─── Stage 1: "Not submitted" is its own status ────────────────────

def test_parser_keeps_not_submitted_hours_as_pending_not_absent():
    today = date(2026, 11, 9)
    rows = [(date(2026, 9, 3), None), (date(2026, 9, 10), "present"), (date(2026, 10, 8), "absent"),
            (date(2026, 11, 12), None)]
    out = sdu_portal.parse_journal_sessions(journal_section("pie01", rows, 4), today=today)
    assert out["pending"] == 1
    assert [s["status"] for s in out["sessions"]] == ["pending", "present", "absent", "upcoming"]


def test_attendance_log_roundtrip_stores_pending_and_replaces_on_resync():
    items = [{"course_code": "INF 451", "sessions": [{"date": "2026-09-03", "status": "pending"},
                                                     {"date": "2026-09-10", "status": "absent"}]}]
    assert monitoring_store.save_attendance_log(repo, "log-student", items) == 2
    items[0]["sessions"][0]["status"] = "present"          # the teacher submitted it
    monitoring_store.save_attendance_log(repo, "log-student", items)
    log = {r["session_date"]: r["status"] for r in monitoring_store.attendance_log(repo, "log-student")}
    assert log == {"2026-09-03": "present", "2026-09-10": "absent"}


# ─── Stage 2: data set + model ─────────────────────────────────────

def test_synthetic_dataset_follows_sdu_rules():
    X, y, gpa = dataset.generate(1000)
    assert X.shape == (1000, len(FEATURES)) and 0.2 < y.mean() < 0.8
    absence = X[:, FEATURES.index("max_absence_pct")]
    assert y[absence >= 30].all()                           # FX: attendance below 70% is always at risk
    assert 0 <= gpa.min() and gpa.max() <= 4


def test_model_is_accurate_and_explains_with_shap():
    bundle = ml.load()
    assert bundle["metrics"]["accuracy"] > 0.8 and bundle["metrics"]["f1"] > 0.75
    result = ml.predict({"max_absence_pct": 24, "pending_hours": 5, "missed_deadlines": 2, "avg_grade": 58, "min_grade": 40})
    assert result["explainer"] == "shap" and 1 <= len(result["reasons"]) <= 3
    assert result["risk"] > ml.predict({"avg_grade": 92, "min_grade": 85})["risk"]


def test_reaching_the_absence_limit_is_always_high_risk():
    f = mon.build_features([{**COURSES[0], "absent": 10}], [90], 1, 0)      # 10 of 30 hours = 33% -> FX
    assert mon.score(f)["fx"] and mon.score(f)["risk_percent"] >= 90


# ─── Safe-to-skip, alerts, simulation ──────────────────────────────

def test_safe_to_skip_counts_hours_before_fx_and_flags_pending():
    items = {c["code"]: c for c in mon.safe_to_skip(COURSES)["items"]}
    assert items["INF 451"]["limit"] == 8 and items["INF 451"]["remaining_skips"] == 2
    assert items["INF 451"]["remaining_if_pending_absent"] == -2 and items["INF 451"]["level"] == "danger"
    assert items["MAT 101"]["limit"] == 13 and items["MAT 101"]["level"] == "safe"


def test_alert_warns_about_not_submitted_hours():
    alerts = mon.build_alerts(COURSES, None)
    assert alerts[0]["type"] == "pending_over_limit"
    assert "4 'Not submitted' in INF 451" in alerts[0]["detail"] and "exceed the limit" in alerts[0]["detail"]


def test_simulation_skipping_more_lowers_gpa_and_raises_risk():
    sim = mon.simulate(COURSES, [75, 70], 0, 0, lectures=2, practices=1, course_code="MAT 101")
    assert sim["skipped_hours"] == 3 and sim["after"]["risk"] >= sim["before"]["risk"]
    assert sim["after"]["predicted_gpa"] <= sim["before"]["predicted_gpa"]
    assert sim["curve"][0]["hours"] == 0 and len(sim["curve"]) >= 11
    big = mon.simulate(COURSES, [75, 70], 0, 0, lectures=12, practices=0, course_code="MAT 101")
    assert "MAT 101" in big["fx_courses"] and "FX" in big["message"]


# ─── Endpoints ─────────────────────────────────────────────────────

@pytest.fixture()
def demo_student():
    session = client.post("/api/sdu/demo-connect", json={}).json()
    tok = session["access_token"]
    client.post("/api/sdu/sync", headers=auth(tok))
    return tok


def test_predict_risk_returns_risk_and_three_reasons(demo_student):
    res = client.post("/api/predict/risk", headers=auth(demo_student))
    assert res.status_code == 200
    body = res.json()
    assert 0 <= body["risk_percent"] <= 100 and len(body["reasons"]) <= 3 and body["model_version"]


def test_simulate_endpoint(demo_student):
    res = client.post("/api/simulate", json={"lectures": 2, "practices": 1}, headers=auth(demo_student))
    assert res.status_code == 200
    body = res.json()
    assert body["skipped_hours"] == 3 and "New predicted GPA" in body["message"] and body["curve"]
    assert client.post("/api/simulate", json={"lectures": 1, "course_code": "NOPE"}, headers=auth(demo_student)).status_code == 404
    assert client.post("/api/simulate", json={"lectures": -1}, headers=auth(demo_student)).status_code == 422


def test_overview_has_every_block(demo_student):
    body = client.get("/api/monitoring/overview", headers=auth(demo_student)).json()
    assert body["has_data"] and body["safe_to_skip"]["items"] and body["risk"]["predicted_gpa"] is not None
    assert "alerts" in body and body["last_synced"]


def test_monitoring_is_student_only_and_needs_login():
    assert client.post("/api/predict/risk").status_code == 401
    teacher = token("teacher@univ.edu", "teacher123")
    assert client.post("/api/simulate", json={"lectures": 1}, headers=auth(teacher)).status_code == 403


def test_teacher_sees_risk_per_student_in_scope():
    body = client.get("/api/teacher/monitoring/students", headers=auth(token("teacher@univ.edu", "teacher123"))).json()
    assert body["items"] == sorted(body["items"], key=lambda r: -r["risk_percent"])


# ─── Stage 4: e-mail alerts ────────────────────────────────────────

def test_curator_email_roundtrip():
    tok = token()
    assert client.put("/api/monitoring/curator", json={"email": "curator@sdu.edu.kz", "name": "Dr. Aidos"}, headers=auth(tok)).status_code == 200
    assert client.get("/api/monitoring/curator", headers=auth(tok)).json()["email"] == "curator@sdu.edu.kz"
    assert client.put("/api/monitoring/curator", json={"email": "nope"}, headers=auth(tok)).status_code == 422
    client.delete("/api/monitoring/curator", headers=auth(tok))
    assert client.get("/api/monitoring/curator", headers=auth(tok)).json()["email"] is None


@pytest.mark.parametrize("use_resend", [True, False])
def test_high_risk_sends_email_to_student_and_curator_once(monkeypatch, no_real_email, use_resend):
    sent = []
    if use_resend:
        monkeypatch.setenv("RESEND_API_KEY", "re_test")
        monkeypatch.setattr(notify, "send_resend", lambda to, subject, text, html=None: (sent.append((to, subject)) or (True, "ok")))
    else:
        monkeypatch.delenv("RESEND_API_KEY", raising=False)
        monkeypatch.setenv("MAILER_SECRET_KEY", "test")
        monkeypatch.setenv("ALERTS_ENABLED", "1")
        assert monitoring_api.automatic_alerts_enabled()
        monkeypatch.setenv("ALERTS_ENABLED", "0")
    tok = client.post("/api/sdu/demo-connect", json={}).json()["access_token"]
    me = client.get("/api/me", headers=auth(tok)).json()
    with repo.connect() as db:
        db.execute("DELETE FROM risk_alert_log WHERE student_id = ?", (me["student_id"],))
    bad = [{**COURSES[0], "absent": 11, "pending": 3}]
    monkeypatch.setattr(monitoring_api, "student_inputs", lambda uid, sid: {
        "courses": bad, "scores": [48], "trend": -4, "missed": 3, "has_data": True, "source": "test",
        "features": mon.build_features(bad, [48], -4, 3)})
    monitoring_store.set_curator(repo, me["student_id"], "curator@sdu.edu.kz")
    first = monitoring_api.send_risk_alert(me["id"], me["student_id"], me["name"])
    again = monitoring_api.send_risk_alert(me["id"], me["student_id"], me["name"])
    if not use_resend:
        sent = [(address, subject) for _, address, subject in no_real_email]
    assert first["sent"] and "curator@sdu.edu.kz" in first["to"] and len(first["to"]) == 2
    assert not again["sent"] and again["reason"] == "already alerted recently"      # no spam inside the cool-down
    assert [s[0] for s in sent].count("curator@sdu.edu.kz") == 1


def test_low_risk_sends_nothing(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    sent = []
    monkeypatch.setattr(notify, "send_resend", lambda *a, **k: (sent.append(a) or (True, "ok")))
    good = [{**COURSES[1], "absent": 0, "pending": 0}]
    monkeypatch.setattr(monitoring_api, "student_inputs", lambda uid, sid: {
        "courses": good, "scores": [92], "trend": 2, "missed": 0, "has_data": True, "source": "test",
        "features": mon.build_features(good, [92], 2, 0)})
    out = monitoring_api.send_risk_alert("u-student", "s1", "Student")
    assert not out["sent"] and not sent

    monkeypatch.setattr(monitoring_api, "analyse", lambda inputs: {"result": {"risk": 0.5, "risk_percent": 50}})
    assert not monitoring_api.send_risk_alert("u-student", "s1", "Student")["sent"] and not sent


def test_resend_without_key_does_not_touch_the_network(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert notify.send_resend("a@b.kz", "s", "t") == (False, "RESEND_API_KEY is not set")


def test_forecast_endpoint_lists_hardest_subjects_first(demo_student):
    body = client.get("/api/monitoring/forecast", headers=auth(demo_student)).json()
    scores = [i["current_score"] for i in body["items"]]
    assert scores == sorted(scores) and len(scores) <= 5


def test_predicted_gpa_starts_from_the_real_gpa_and_only_adds_risk_effects():
    clean = mon.build_features([COURSES[1]], [90, 85], 0, 0, current_gpa=3.5)
    out = mon.score(clean)
    assert out["gpa_basis"] == "current" and abs(out["predicted_gpa"] - 3.5) < 0.15      # perfect record: stays at the real GPA
    risky = mon.build_features([{**COURSES[1], "absent": 10, "pending": 3}], [90, 85], -9, 2, current_gpa=3.5)
    assert mon.score(risky)["predicted_gpa"] <= 3.5                                       # risks only pull it down, never above the real GPA
    assert mon.score(mon.build_features([COURSES[1]], [90, 85], 0, 0))["gpa_basis"] == "model"


def test_simulation_curve_never_improves_when_skipping_more():
    for gpa in (None, 3.4):
        sim = mon.simulate([{**COURSES[1], "absent": 0}], [92, 88], 1, 0, lectures=3, practices=1, course_code="MAT 101", current_gpa=gpa)
        risks = [p["risk"] for p in sim["curve"]]
        gpas = [p["predicted_gpa"] for p in sim["curve"]]
        assert risks == sorted(risks) and gpas == sorted(gpas, reverse=True)
        assert sim["curve"][0]["risk"] == sim["before"]["risk"]
        assert sim["risk_change"] >= 0 and sim["gpa_change"] <= 0


def test_risk_is_explained_in_words_for_low_and_high_risk():
    low = mon.score(mon.build_features([COURSES[1]], [92, 88], 1, 0, current_gpa=3.5))
    assert low["summary"] and low["helping"] and "no factor is pushing it up" in low["summary"] or low["reasons"]
    assert all(h["impact"] < 0 for h in low["helping"])
    high = mon.add_course_detail(mon.score(mon.build_features(COURSES, [72, 65], -2, 1)), COURSES)
    assert high["summary"].startswith(f"Your risk is {high['risk_percent']}%") and "mainly because" in high["summary"]
    assert "INF 451" in high["summary"] or len(high["reasons"]) > 0


def test_training_on_a_real_data_csv_and_rejecting_bad_files(tmp_path):
    import csv

    from app.ml import train as train_mod
    X, y, gpa = dataset.generate(400, seed=7)         # only a stand-in for a real export, to test the pipeline
    path = tmp_path / "students.csv"
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([*FEATURES, "is_at_risk", "gpa"])
        for row, label, g in zip(X, y, gpa):
            w.writerow([*row, int(label), g])
    bundle = train_mod.train(save=False, csv_path=str(path))
    assert bundle["metrics"]["data_source"] == "real:students.csv" and bundle["metrics"]["gpa_model_data"] == "real"
    assert bundle["metrics"]["train_rows"] == 320 and bundle["metrics"]["accuracy"] > 0.7

    few = tmp_path / "few.csv"
    few.write_text(train_mod.template_csv())
    with pytest.raises(SystemExit, match="Not enough real data"):
        train_mod.load_csv(str(few))
    wrong = tmp_path / "wrong.csv"
    wrong.write_text("a,b\n1,2\n")
    with pytest.raises(SystemExit, match="needs columns"):
        train_mod.load_csv(str(wrong))


def test_public_data_rows_become_model_factors():
    from app.ml import public_data
    rows = [{"G1": "14", "G2": "16", "G3": "15", "absences": "9"},        # good student
            {"G1": "8", "G2": "7", "G3": "6", "absences": "0"},           # failing student
            {"G1": "x", "G2": "7", "G3": "6", "absences": "0"},           # broken row: skipped
            {"G1": "25", "G2": "7", "G3": "6", "absences": "0"}]          # outside the 0-20 scale: skipped
    X, y, gpa = public_data.map_rows(rows)
    assert X.shape == (2, len(FEATURES)) and list(y) == [0, 1]
    f = dict(zip(FEATURES, X[0]))
    assert f["avg_grade"] == 75.0 and f["grade_trend"] == 10.0 and f["max_absence_pct"] == 20.0 and f["attendance_pct"] == 80.0
    assert f["pending_hours"] == 0 and f["missed_deadlines"] == 0           # not in this data set
    assert gpa[0] == 2.67 and gpa[1] == 0.0                                  # G3 15/20 = 75% = B- = 2.67; 6/20 = 30% = 0


def test_saved_model_was_trained_on_real_students():
    metrics = ml.load()["metrics"]
    assert metrics["data_source"].startswith("public:uci-student-performance") and metrics["roc_auc"] > 0.9


def test_env_file_is_loaded_but_never_overrides_real_variables(tmp_path, monkeypatch):
    from app import load_env
    (tmp_path / ".env").write_text("STUDYMATE_FROM_FILE=file\nSTUDYMATE_ALREADY_SET=file\n")
    monkeypatch.delenv("STUDYMATE_FROM_FILE", raising=False)
    monkeypatch.setenv("STUDYMATE_ALREADY_SET", "real")
    assert load_env([tmp_path, tmp_path / "missing"]) == 1
    import os
    assert os.environ["STUDYMATE_FROM_FILE"] == "file" and os.environ["STUDYMATE_ALREADY_SET"] == "real"
    monkeypatch.delenv("STUDYMATE_FROM_FILE")


def test_model_warm_up_runs_in_the_background_and_never_raises(monkeypatch):
    calls = []
    monkeypatch.setattr(monitoring_api.ml, "load", lambda *a, **k: calls.append("load"))
    monkeypatch.setattr(monitoring_api.ml, "predict", lambda *a, **k: calls.append("predict"))
    monitoring_api.warm_up_model()
    import threading
    for t in threading.enumerate():
        if t.name == "model-warm-up":
            t.join(5)
    assert calls == ["load", "predict"]
    monkeypatch.setattr(monitoring_api.ml, "load", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    monitoring_api.warm_up_model()                       # a failing warm-up must not break startup
    for t in threading.enumerate():
        if t.name == "model-warm-up":
            t.join(5)


ONE_COURSE = [{"code": "INF 451", "name": "Project management information system", "hours": 30, "present": 14,
               "absent": 0, "permitted": 0, "pending": 0, "remaining": 16}]


def test_skipping_classes_moves_risk_and_gpa_well_before_the_fx_limit():
    sim = mon.simulate(ONE_COURSE, [75], 0, 0, lectures=2, practices=1, course_code="INF 451", current_gpa=2.67)
    assert sim["risk_change"] >= 10 and sim["gpa_change"] <= -0.1                    # 3 of 8 allowed hours: clearly visible
    risks = [p["risk"] for p in sim["curve"]]
    gpas = [p["predicted_gpa"] for p in sim["curve"]]
    assert risks == sorted(risks) and gpas == sorted(gpas, reverse=True)
    assert risks[0] < 0.05 and risks[8] >= 0.8 and not sim["curve"][8]["fx"]            # 8 hours = the last allowed one
    assert sim["curve"][9]["fx"] and risks[9] >= 0.9 and gpas[8] - gpas[9] >= 0.3       # the 9th hour is FX: a clear drop
    assert len({round(r, 2) for r in risks[:8]}) == 8                                   # rises step by step, not flat then a jump


def test_not_submitted_hours_count_as_half_an_absence_in_the_pressure():
    absent = [{**ONE_COURSE[0], "absent": 3}]
    pending = [{**ONE_COURSE[0], "pending": 6}]
    assert mon.attendance_pressure(absent) == mon.attendance_pressure(pending) == pytest.approx(3 / 8, abs=1e-3)
    assert mon.score(mon.build_features(pending, [75], 0, 0, 2.67))["risk"] > mon.score(mon.build_features(ONE_COURSE, [75], 0, 0, 2.67))["risk"]


def test_absence_pressure_is_named_as_a_reason_for_the_risk():
    cs = [{**ONE_COURSE[0], "absent": 5}]
    result = mon.add_course_detail(mon.score(mon.build_features(cs, [75], 0, 0, 2.67)), cs)
    assert result["reasons"][0]["feature"] == "attendance_pressure" and "62%" in result["reasons"][0]["text"]
    assert "absences allowed before FX" in result["summary"]


def test_simulation_message_rounds_gpa_half_up_like_the_screen():
    assert "New predicted GPA: 2.3." in mon._sim_message({"predicted_gpa": 2.25, "risk_percent": 10}, 1, [])


# ─── "Email me" / support replies: Resend is used when configured ───

class _Resp:
    def __init__(self, status, text=""): self.status_code, self.text = status, text


def test_email_goes_through_resend_when_a_key_is_set(monkeypatch):
    import app.main as main_mod
    for name in ("MAILER_SECRET_KEY", "GMAIL_APP_PASSWORD", "SMTP_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    seen = {}
    monkeypatch.setattr(notify.httpx, "post", lambda url, json, headers, timeout: (seen.update(url=url, to=json["to"], auth=headers["Authorization"]) or _Resp(200)))
    assert main_mod.deliver_email("me@sdu.edu.kz", "Weekly summary", "text") == (True, "Sent via Resend")
    assert seen == {"url": notify.RESEND_URL, "to": ["me@sdu.edu.kz"], "auth": "Bearer re_test"}


def test_email_without_any_service_says_what_to_do(monkeypatch):
    import app.main as main_mod
    for name in ("RESEND_API_KEY", "MAILER_SECRET_KEY", "GMAIL_APP_PASSWORD", "SMTP_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    sent, why = main_mod.deliver_email("me@sdu.edu.kz", "s", "t")
    assert not sent and "RESEND_API_KEY" in why and "restart the backend" in why


def test_resend_test_sender_restriction_is_explained(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    body = "You can only send testing emails to your own email address (owner@example.com)."
    monkeypatch.setattr(notify.httpx, "post", lambda *a, **k: _Resp(403, body))
    sent, why = notify.send_resend("friend@sdu.edu.kz", "s", "t")
    assert not sent and "same address" in why and "verify your own domain" in why


def test_batched_predictions_match_the_single_ones():
    rows = [{"max_absence_pct": a, "avg_grade": g, "current_gpa": cg} for a, g, cg in ((0, 80, 3.2), (12, 62, None), (25, 90, 3.8), (5, 55, 1.9))]
    for row, (risk, gpa) in zip(rows, ml.predict_many(rows), strict=True):
        single = ml.predict(row)
        assert risk == pytest.approx(single["risk"], abs=1e-4) and gpa == pytest.approx(single["predicted_gpa"], abs=1e-2)
    assert ml.predict_many([]) == []


def _course(hours):
    return [{"code": "X", "name": "Course", "hours": hours, "present": hours // 3, "absent": 0, "permitted": 0, "pending": 0, "remaining": hours * 2 // 3}]


def test_one_missed_hour_costs_more_in_a_course_with_fewer_weekly_lessons():
    one, three = (mon.simulate(_course(h), [75], 0, 0, 1, 0, "X", current_gpa=2.67, max_hours=12) for h in (15, 45))
    assert one["course_cost"]["weekly_hours"] == 1.0 and three["course_cost"]["weekly_hours"] == 3.0
    assert one["course_cost"]["cost_per_hour_pct"] > 2 * three["course_cost"]["cost_per_hour_pct"]      # 25% against 8% of the allowance
    assert one["risk_change"] >= 3 * three["risk_change"] and one["gpa_change"] < three["gpa_change"]    # 1 absence: 11% against 2% risk


def test_simulation_curve_length_follows_max_hours_and_names_fx_courses():
    sim = mon.simulate(_course(15), [75], 0, 0, 0, 0, "X", current_gpa=2.67, max_hours=30)
    assert len(sim["curve"]) == 31 and sim["hours_per_class"] == {"lecture": 1.0, "practice": 1.0}
    first_fx = next(p for p in sim["curve"] if p["fx"])
    assert first_fx["fx_courses"] == ["X"] and first_fx["hours"] == 5                              # limit 4: the 5th hour is FX


def test_simulate_endpoint_accepts_max_hours(demo_student):
    body = client.post("/api/simulate", json={"lectures": 0, "practices": 0, "max_hours": 24}, headers=auth(demo_student)).json()
    assert len(body["curve"]) == 25 and body["course_cost"]["cost_per_hour_pct"] >= 1
    assert client.post("/api/simulate", json={"max_hours": 99}, headers=auth(demo_student)).status_code == 422


def test_absences_in_several_courses_add_up_but_the_worst_course_counts_most():
    base = [{"code": c, "name": c, "hours": 45, "present": 20, "absent": 0, "permitted": 0, "pending": 0, "remaining": 25} for c in "ABC"]
    one = [{**base[0], "absent": 6}, base[1], base[2]]
    three = [{**c, "absent": 6} for c in base]
    r1, r3 = (mon.score(mon.build_features(cs, [75], 0, 0, 2.8))["risk"] for cs in (one, three))
    assert r3 > r1 > mon.score(mon.build_features(base, [75], 0, 0, 2.8))["risk"]       # more courses = more risk
    assert mon._pressure_effect([0.5, 0.5, 0.5])[0] < 3 * mon._pressure_effect([0.5])[0]   # ...but not three times as much


def test_a_missed_hour_in_any_course_moves_the_overall_risk_at_once():
    worst = {"code": "A", "name": "A", "hours": 45, "present": 20, "absent": 9, "permitted": 0, "pending": 0, "remaining": 16}
    other = {"code": "B", "name": "B", "hours": 45, "present": 20, "absent": 0, "permitted": 0, "pending": 0, "remaining": 25}
    sim = mon.simulate([worst, other], [75], 0, 0, 1, 0, "B", current_gpa=2.8, max_hours=5)
    assert sim["curve"][1]["risk"] > sim["curve"][0]["risk"]                              # the very first hour counts
    assert sim["curve"][3]["predicted_gpa"] < sim["curve"][0]["predicted_gpa"]            # and the GPA follows within a few hours
