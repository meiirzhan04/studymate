"""US-18 / US-19: goal feasibility, saving rules and progress tracking."""
import secrets

import pytest

from app import goals
from app.goals import ACHIEVED, AHEAD, BEHIND, INSUFFICIENT, ON_TRACK, UNACHIEVABLE
from test_api import _insights_student, auth, client, token


def comps(*parts):
    return [{"name": n, "weight": w, "score": s} for n, w, s in parts]


def journal(hours, present, absent, permitted=0, lesson="DevOps", code="INF 410"):
    return {"lesson": lesson, "course_code": code, "hours": hours, "present": present, "absent": absent,
            "permitted": permitted, "absence_percent": round(absent / hours * 100, 1)}


# ─── Attendance ──────────────────────────────────────────────────────
def test_attendance_example_from_the_story():
    # 30 scheduled, 20 held, 17 attended, 3 missed, 10 left: (17 + 10) / 30 = 90%
    row = journal(30, 17, 3)
    out = goals.evaluate_attendance_course(row, 98)
    assert out["status"] == UNACHIEVABLE and out["maximum"] == 90.0 and out["suggested"] == 90.0
    assert "maximum possible attendance is 90%" in out["message"]
    ok = goals.evaluate_attendance_course(row, 90)
    assert ok["verdict"] == "achievable" and ok["must_attend"] == 10 and ok["affordable"] == 0
    assert "must attend all 10 remaining" in ok["message"]


def test_attendance_recovery_counts_hours_that_can_still_be_missed():
    out = goals.evaluate_attendance_course(journal(40, 20, 2), 85)   # at most 6 absent hours keep 85%
    assert out["affordable"] == 4 and out["must_attend"] == 14 and out["remaining"] == 18
    assert out["status"] == AHEAD   # 2 absences in 22 hours projects to ~89%


def test_excused_absences_are_not_absences():
    # SDU: permitted hours do not count as absent, exactly like the prompt's (attended + remaining) / total
    out = goals.evaluate_attendance_course(journal(30, 15, 1, permitted=4), 95)
    assert out["maximum"] == pytest.approx(96.6) and out["verdict"] == "achievable"


def test_zero_remaining_classes_is_the_final_result():
    done = journal(30, 28, 2)
    assert goals.evaluate_attendance_course(done, 90)["status"] == ACHIEVED
    late = goals.evaluate_attendance_course(done, 95)
    assert late["status"] == UNACHIEVABLE and "All classes are over" in late["message"]


def test_unknown_class_counts_never_invent_remaining_classes():
    # Only a percentage (the official SDU API): total and remaining classes are unknown
    row = {"lesson": "DevOps", "absence_percent": 25.0}
    out = goals.evaluate_attendance_course(row, 70)
    assert out["status"] == INSUFFICIENT and out.get("verdict") is None and "remaining" not in out
    assert "total scheduled class hours" in out["message"]
    overall = goals.evaluate_attendance_overall([row], 70)
    assert overall["status"] == INSUFFICIENT and overall["known"] is False
    assert goals.evaluate_attendance_overall([], 90)["status"] == INSUFFICIENT


def test_recorded_absences_alone_prove_a_target_impossible():
    # Absence never decreases: 25% missed caps attendance at 75% (75.5% allowing for SDU's rounding)
    row = {"lesson": "DevOps", "absence_percent": 25.0}
    out = goals.evaluate_attendance_course(row, 99)
    assert out["status"] == UNACHIEVABLE and out["maximum"] == 75.5 and out["suggested"] == 75.0
    assert goals.evaluate_attendance_course(row, 75.5)["status"] == INSUFFICIENT   # inside the rounding margin
    rows = [{"lesson": "A", "absence_percent": 2.0}, {"lesson": "B", "absence_percent": 3.2}]
    overall = goals.evaluate_attendance_overall(rows, 99)
    assert overall["status"] == UNACHIEVABLE and overall["bound_only"] is True
    assert overall["maximum"] == 97.6   # mean(98.5, 96.85)
    assert goals.evaluate_attendance_overall(rows, 97)["status"] == INSUFFICIENT


def test_inconsistent_counts_are_not_trusted():
    out = goals.evaluate_attendance_course({"lesson": "X", "hours": 10, "present": 9, "absent": 3}, 80)
    assert out["status"] == INSUFFICIENT


def test_rounding_never_accepts_an_impossible_attendance_target():
    row = journal(45, 20, 2)       # 95.555…%, SDU shows "4%" absence
    assert goals.evaluate_attendance_course(row, 95.6)["status"] == UNACHIEVABLE
    assert goals.evaluate_attendance_course(row, 95.5)["verdict"] == "achievable"
    assert goals.evaluate_attendance_course(row, 95)["maximum"] == 95.5   # shown rounded down


def test_overall_attendance_uses_the_official_mean_of_course_percentages():
    rows = [journal(30, 17, 3, lesson="A", code="A 1"), journal(60, 30, 0, lesson="B", code="B 1")]
    out = goals.evaluate_attendance_overall(rows, 96)
    assert out["maximum"] == 95.0   # mean(90, 100)
    rows = [journal(10, 5, 2, lesson="A", code="A 1"), journal(90, 40, 0, lesson="B", code="B 1")]
    out = goals.evaluate_attendance_overall(rows, 85)
    assert out["max_exact"] == pytest.approx(90.0)          # mean(80, 100); hour-weighted would be 98
    assert goals.evaluate_attendance_overall(rows, 91)["status"] == UNACHIEVABLE


# ─── Course grades ───────────────────────────────────────────────────
def test_required_final_exam_score_example():
    # 56.4 weighted points done, final worth 40%: (90 - 56.4) / 0.4 = 84
    out = goals.evaluate_course(comps(("Coursework", 0.6, 94.0), ("Final Exam", 0.4, None)), 90)
    assert out["required_average"] == 84.0
    assert out["message"] == "You need at least 84/100 on your Final Exam to reach 90%."
    assert out["status"] == AHEAD   # 94% so far against 84% needed


def test_impossible_course_target_reports_the_maximum():
    out = goals.evaluate_course(comps(("MT", 0.6, 75.0), ("FIN", 0.4, None)), 95)   # 45 + 40 = 85
    assert out["status"] == UNACHIEVABLE and out["maximum"] == 85.0 and out["suggested"] == 85.0
    assert "maximum achievable grade is 85%" in out["message"]


def test_ungraded_is_not_zero_and_zero_is_not_ungraded():
    ungraded = goals.evaluate_course(comps(("Quiz", 0.5, None), ("FIN", 0.5, None)), 90)
    zero = goals.evaluate_course(comps(("Quiz", 0.5, 0.0), ("FIN", 0.5, None)), 90)
    assert ungraded["maximum"] == 100.0 and ungraded["verdict"] == "achievable"
    assert zero["maximum"] == 50.0 and zero["status"] == UNACHIEVABLE


def test_different_weighting_systems():
    a = goals.evaluate_course(comps(("Labs", 0.3, 80.0), ("MT", 0.3, 70.0), ("FIN", 0.4, None)), 80)
    b = goals.evaluate_course(comps(("Project", 0.5, 80.0), ("FIN", 0.5, None)), 80)
    assert a["required_average"] == 87.5 and b["required_average"] == 80.0


def test_several_remaining_assessments_show_each_minimum():
    out = goals.evaluate_course(comps(("Quiz", 0.2, 80.0), ("MT", 0.3, None), ("FIN", 0.5, None)), 90)
    assert out["required_average"] == 92.5           # same score on both
    mins = {r["name"]: r["min_score"] for r in out["remaining"]}
    assert mins == {"MT": 80.0, "FIN": 88.0}          # with 100 on the other one
    assert "same on every remaining assessment" in out["message"]
    assert out["status"] == BEHIND                    # 80% so far, 92.5% needed


def test_dropped_lowest_quiz_and_curve_policies():
    parts = [{"name": f"Quiz {i}", "weight": 0.1, "score": s, "group": "quiz"} for i, s in enumerate((40.0, 90.0, 90.0, None))]
    parts.append({"name": "FIN", "weight": 0.6, "score": None})
    plain = goals.evaluate_course(parts, 95)
    dropped = goals.evaluate_course(parts, 95, policy={"drop_lowest": {"quiz": 1}})
    assert plain["maximum"] == 92.0 and plain["status"] == UNACHIEVABLE
    assert dropped["maximum"] == pytest.approx(97.3, abs=0.1) and dropped["verdict"] == "achievable"
    curved = goals.evaluate_course(parts, 95, policy={"curve": 5})
    assert curved["maximum"] == 97.0


def test_secured_and_final_course_goals():
    secured = goals.evaluate_course(comps(("Work", 0.8, 100.0), ("FIN", 0.2, None)), 80)
    assert secured["status"] == ACHIEVED and "Goal secured" in secured["message"]
    final = goals.evaluate_course(comps(("Final", 1.0, 81.0)), 80)
    assert final["status"] == ACHIEVED and final["final"] is True
    assert goals.evaluate_course(comps(("Final", 1.0, 81.0)), 85)["status"] == UNACHIEVABLE


def test_missing_weights_are_insufficient_data():
    assert goals.evaluate_course(None, 90)["status"] == INSUFFICIENT
    partial = goals.evaluate_course(comps(("MT", 0.3, 80.0), ("FIN", 0.4, None)), 90)   # adds up to 70%
    assert partial["status"] == INSUFFICIENT and "100%" in partial["message"]


def test_course_rounding_boundary():
    out = goals.evaluate_course(comps(("MT", 1 / 3, 80.0), ("FIN", 2 / 3, None)), 93.4)   # max 93.333…
    assert out["status"] == UNACHIEVABLE and out["maximum"] == 93.3


# ─── GPA ─────────────────────────────────────────────────────────────
def course(name, credits, parts):
    return {"course": name, "code": name, "credits": credits, "evaluation": goals.evaluate_course(parts, None)}


def test_semester_and_cumulative_gpa_are_different_goals():
    term = [course("A", 5, comps(("MT", 0.5, 90.0), ("FIN", 0.5, None))),      # max 95 -> A 4.0
            course("B", 5, comps(("MT", 0.5, 60.0), ("FIN", 0.5, None)))]      # max 80 -> B 3.0
    semester = goals.evaluate_gpa(3.8, "semester", term)
    assert semester["maximum"] == 3.5 and semester["status"] == UNACHIEVABLE
    # 3.24 over 60 earlier ECTS: even a perfect term cannot lift the cumulative GPA to 3.8
    past = {"points": 3.24 * 60, "credits": 60.0}
    cumulative = goals.evaluate_gpa(3.8, "cumulative", term, past, 3.24)
    assert cumulative["maximum"] == pytest.approx(floor2((3.24 * 60 + 4.0 * 5 + 3.0 * 5) / 70))
    assert cumulative["status"] == UNACHIEVABLE and cumulative["current"] == 3.24
    ok = goals.evaluate_gpa(3.25, "cumulative", term, past, 3.24)   # max (194.4 + 20 + 15) / 70 = 3.277
    assert ok["verdict"] == "achievable" and ok["required_score"] is not None


def floor2(x):
    import math
    return math.floor(x * 100 + 1e-9) / 100


def test_gpa_without_breakdowns_is_a_range_not_a_guess():
    term = [course("A", 5, None), course("B", 5, comps(("Final", 1.0, 70.0)))]   # B final: C+ 2.33
    assert goals.evaluate_gpa(3.5, "semester", term)["status"] == UNACHIEVABLE   # (4 + 2.33) / 2 = 3.165
    unsure = goals.evaluate_gpa(3.0, "semester", term)
    assert unsure["status"] == INSUFFICIENT and unsure["verdict"] == "unverified" and unsure["bound_only"] is True


def test_cumulative_gpa_without_transcript_is_insufficient():
    term = [course("A", 5, comps(("Final", 1.0, 90.0)))]
    out = goals.evaluate_gpa(3.0, "cumulative", term, None)
    assert out["status"] == INSUFFICIENT and "transcript" in out["message"]


def test_gpa_achieved_when_it_cannot_fall_below_target():
    term = [course("A", 5, comps(("Work", 0.9, 100.0), ("FIN", 0.1, None)))]   # minimum 90 -> 3.67
    assert goals.evaluate_gpa(3.5, "semester", term)["status"] == ACHIEVED


# ─── API: saving rules ───────────────────────────────────────────────
def breakdown_student():
    return _insights_student({
        "Physics": [{"name": "MT", "score": 75, "weight": 0.6}, {"name": "FIN", "score": None, "weight": 0.4}],   # max 85
        "Calculus": [{"name": "Final", "score": 81, "weight": 1.0}],
    })


def test_valid_goals_are_saved_and_survive_a_new_login():
    u, tok = breakdown_student()
    res = client.put("/api/student/goals", headers=auth(tok),
                     json={"target_gpa": 3.0, "course_targets": {"PHY 101": 80}})
    assert res.status_code == 200
    fresh = token(u["student_id"], "password123")
    body = client.get("/api/student/goals", headers=auth(fresh)).json()
    assert body["goal"]["target_gpa"] == 3.0 and body["goal"]["gpa_basis"] == "cumulative"
    assert body["goal"]["course_targets"] == {"PHY 101": 80} and body["goal"]["semester"] == "spring-2026"
    row = next(c for c in body["tracking"]["courses"] if c["code"] == "PHY 101")
    assert row["evaluation"]["required_average"] == 87.5 and row["evaluation"]["maximum"] == 85.0


def test_impossible_course_target_is_rejected_and_valid_ones_still_save():
    _u, tok = breakdown_student()
    assert client.put("/api/student/goals", headers=auth(tok), json={"course_targets": {"PHY 101": 80}}).status_code == 200
    res = client.put("/api/student/goals", headers=auth(tok),
                     json={"target_gpa": 3.0, "course_targets": {"PHY 101": 95, "CAL 101": 80}})
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["errors"]["course_targets"]["PHY 101"]["maximum"] == 85.0
    assert "not achievable" in detail["errors"]["course_targets"]["PHY 101"]["message"]
    saved = client.get("/api/student/goals", headers=auth(tok)).json()["goal"]
    # The rejected target kept its previous valid value; the others were saved
    assert saved["course_targets"] == {"PHY 101": 80, "CAL 101": 80} and saved["target_gpa"] == 3.0


def test_impossible_gpa_target_is_rejected_on_the_backend():
    from app.main import repo
    u, tok = breakdown_student()
    # 60 earlier ECTS at 3.0, then Physics at most 85 (B+ 3.33) and Calculus final 81 (B 3.0), 5 ECTS each
    repo.save_snapshot(u["id"], "transcript", {"courses": [
        {"semester": 1, "course_code": "OLD 100", "course_name": "Earlier terms", "grade_point": 3.0, "ects": 60}]})
    res = client.put("/api/student/goals", headers=auth(tok), json={"target_gpa": 3.5})
    assert res.status_code == 422
    err = res.json()["detail"]["errors"]["target_gpa"]
    assert err["maximum"] == 3.02 and "cumulative GPA" in err["message"]   # (180 + 16.65 + 15) / 70
    assert client.get("/api/student/goals", headers=auth(tok)).json()["goal"]["target_gpa"] is None
    ok = client.put("/api/student/goals", headers=auth(tok), json={"target_gpa": 3.0})
    assert ok.status_code == 200 and ok.json()["tracking"]["gpa"]["verdict"] == "achievable"


def test_gpa_goal_is_always_the_cumulative_gpa():
    _u, tok = breakdown_student()
    assert client.put("/api/student/goals", headers=auth(tok), json={"target_gpa": 3.0, "gpa_basis": "semester"}).status_code == 422
    body = client.get("/api/student/goals", headers=auth(tok)).json()
    assert list(body["tracking"]["gpa_options"]) == ["cumulative"] and body["tracking"]["gpa"]["basis"] == "cumulative"


def test_unverifiable_targets_are_saved_with_a_warning():
    _u, tok = breakdown_student()
    res = client.put("/api/student/goals", headers=auth(tok), json={"target_attendance": 99, "target_gpa": 3.9})
    assert res.status_code == 200
    tracking = res.json()["tracking"]
    assert tracking["attendance"]["status"] == INSUFFICIENT and tracking["gpa"]["status"] == INSUFFICIENT


def demo_student():
    from app.main import repo
    u = repo.create_user("Goal Demo", f"4{secrets.randbelow(10**8):08d}", "password123")
    tok = token(u["student_id"], "password123")
    assert client.post("/api/sdu/demo-connect", headers=auth(tok)).status_code == 200
    assert client.post("/api/sdu/sync", headers=auth(tok)).status_code == 200
    return u, tok


def test_impossible_attendance_target_is_rejected_with_the_sdu_journal():
    _u, tok = demo_student()
    body = client.get("/api/student/goals", headers=auth(tok)).json()
    att = body["tracking"]["attendance"]
    assert att["known"] is True and att["maximum"] < 92
    res = client.put("/api/student/goals", headers=auth(tok), json={"target_attendance": 98})
    assert res.status_code == 422
    err = res.json()["detail"]["errors"]["target_attendance"]
    assert err["maximum"] == att["maximum"] and "Even if you attend every remaining class" in err["message"]
    assert client.put("/api/student/goals", headers=auth(tok), json={"target_attendance": 85}).status_code == 200


def test_sync_keeps_sdu_breakdown_and_class_hours():
    from app.main import repo
    u, tok = demo_student()
    assert (repo.get_snapshot(u["id"], "attendance_detail") or {}).get("rows")
    body = client.get("/api/student/goals", headers=auth(tok)).json()
    pm = next(c for c in body["tracking"]["courses"] if c["course"] == "Project Management")
    assert pm["evaluation"]["source"] == "sdu" and pm["evaluation"]["maximum"] == 94.0   # 18 + 26 + 50


def test_goal_becomes_unachievable_after_new_results_and_alerts_once():
    from app.main import repo
    u, tok = breakdown_student()
    assert client.put("/api/student/goals", headers=auth(tok), json={"course_targets": {"PHY 101": 84}}).status_code == 200
    first = client.get("/api/student/goals", headers=auth(tok)).json()["tracking"]
    assert next(c for c in first["courses"] if c["code"] == "PHY 101")["evaluation"]["status"] == BEHIND   # 75% so far, 97.5% needed

    import json as _json
    with repo.connect() as db:   # the final exam result arrives: 70
        db.execute("UPDATE grades SET components_json = ? WHERE student_id = ? AND course = 'Physics'",
                   (_json.dumps([{"name": "MT", "score": 75, "weight": 0.6}, {"name": "FIN", "score": 70, "weight": 0.4}]), u["student_id"]))
        db.commit()
    after = client.get("/api/student/goals", headers=auth(tok)).json()["tracking"]
    phy = next(c for c in after["courses"] if c["code"] == "PHY 101")["evaluation"]
    assert phy["status"] == UNACHIEVABLE and "73%" in phy["message"]
    assert any(a["title"] == "Course goal no longer achievable" for a in after["alerts"])

    client.get("/api/student/goals", headers=auth(tok))   # reloading must not repeat the notification
    items = client.get("/api/student/notifications", headers=auth(tok)).json()["items"]
    assert sum(1 for n in items if n["type"] == "goal" and n["title"] == "Course goal no longer achievable") == 1


def test_behind_pace_comes_with_a_concrete_recommendation():
    _u, tok = _insights_student({
        "Physics": [{"name": "Quiz", "score": 60, "weight": 0.2}, {"name": "MT", "score": None, "weight": 0.3},
                    {"name": "FIN", "score": None, "weight": 0.5}],
    })
    res = client.put("/api/student/goals", headers=auth(tok), json={"course_targets": {"PHY 101": 80}})
    tracking = res.json()["tracking"]
    ev = tracking["courses"][0]["evaluation"]
    assert ev["status"] == BEHIND and ev["required_average"] == 85.0
    assert any("Prioritise FIN in Physics" in r for r in tracking["recommendations"])
    assert any(a["title"] == "Grade below the required trajectory" for a in tracking["alerts"])


def test_goals_are_private_to_the_student():
    teacher = token("teacher@univ.edu", "teacher123")
    assert client.put("/api/student/goals", headers=auth(teacher), json={"target_gpa": 3.0}).status_code == 403
    assert client.put("/api/student/goals", json={"target_gpa": 3.0}).status_code == 401
    _u1, tok1 = breakdown_student()
    _u2, tok2 = breakdown_student()
    client.put("/api/student/goals", headers=auth(tok1), json={"target_gpa": 2.5})
    assert client.get("/api/student/goals", headers=auth(tok2)).json()["goal"] is None


def test_gpa_advice_uses_the_students_own_course_targets():
    # 3.24 over 120 ECTS, five open 6-ECTS courses with nothing graded, 90% (A-, 3.67) targeted in each
    open_course = comps(("MT", 0.3, None), ("FIN", 0.7, None))
    term = [{"course": f"C{i}", "code": f"C{i}", "credits": 6, "evaluation": goals.evaluate_course(open_course, None)}
            for i in range(5)]
    past = {"points": 3.24 * 120, "credits": 120.0}
    targets = {f"C{i}": 90 for i in range(5)}
    short = goals.evaluate_gpa(3.36, "cumulative", term, past, 3.24, targets)
    assert short["required_gp"] == 3.84 and short["targets_gpa"] == 3.32 and short["targets_enough"] is False
    tip = goals.recommendations({"gpa": short, "attendance": {}, "courses": []})
    assert tip == ["Your course targets add up to a cumulative GPA of 3.32, below your 3.36 goal: "
                   "your open courses need an average grade point of 3.84 (A- = 3.67, A = 4.00)."]
    enough = goals.evaluate_gpa(3.3, "cumulative", term, past, 3.24, targets)
    assert goals.recommendations({"gpa": enough, "attendance": {}, "courses": []}) == [
        "Reaching your course targets gives a cumulative GPA of 3.32, enough for your 3.30 goal."]


def test_no_high_score_alert_when_nothing_is_graded_yet():
    open_course = comps(("MT", 0.3, None), ("FIN", 0.7, None))
    tracking = {"courses": [{"course": "DevOps", "code": "D 1", "target": 90, "evaluation": goals.evaluate_course(open_course, 90)}]}
    assert goals.alerts(tracking) == []
    assert goals.recommendations(tracking) == []
    behind = comps(("MT", 0.3, 80.0), ("FIN", 0.7, None))   # 80 on the midterm: the final now needs 94.3
    tracking = {"courses": [{"course": "DevOps", "code": "D 1", "target": 90, "evaluation": goals.evaluate_course(behind, 90)}]}
    assert any(a["title"] == "High score needed" and "94.3%" in a["detail"] for a in goals.alerts(tracking))


# ─── GPA planner ─────────────────────────────────────────────────────
def plan_course(name, credits, parts):
    return {"course": name, "code": name, "credits": credits, "breakdown": parts,
            "evaluation": goals.evaluate_course(parts, None)}


def test_planner_suggests_grades_that_reach_the_gpa_from_current_scores():
    open_course = comps(("MT", 0.3, None), ("FIN", 0.7, None))
    term = [plan_course("Mobile", 6, comps(("MT", 0.3, 96.0), ("FIN", 0.7, None))),
            plan_course("DevOps", 5, open_course), plan_course("NLP", 5, open_course),
            plan_course("PM", 6, comps(("MT", 0.3, 70.0), ("FIN", 0.7, None))),   # weak midterm
            plan_course("Law", 3, None)]
    past = {"points": 3.24 * 120, "credits": 120.0}
    plan = goals.plan_grades(3.3, "cumulative", term, past)
    assert plan["status"] == "planned" and plan["gpa"] >= 3.3
    by = {c["course"]: c for c in plan["courses"]}
    # The weak-midterm course is asked for less; the others make up for it
    assert by["PM"]["letter"] == "B+" and by["PM"]["required_average"] == 91.5
    assert by["Mobile"]["letter"] == "A-" and by["Mobile"]["required_average"] == 87.5
    # The plan really adds up: recompute the GPA from the suggested letters
    points = past["points"] + sum(c["grade_point"] * c["credits"] for c in plan["courses"])
    assert points / (past["credits"] + 25) >= 3.3


def test_planner_respects_finished_courses_caps_and_impossible_targets():
    term = [plan_course("Done", 5, comps(("Final", 1.0, 81.0))),                       # B, fixed
            plan_course("Capped", 5, comps(("MT", 0.6, 60.0), ("FIN", 0.4, None)))]    # at most 76 -> B-
    plan = goals.plan_grades(2.8, "semester", term)
    by = {c["course"]: c for c in plan["courses"]}
    assert by["Done"]["fixed"] is True and by["Done"]["letter"] == "B"
    assert by["Capped"]["letter"] in ("B-", "C+") and by["Capped"]["grade_point"] <= 2.67
    assert goals.plan_grades(3.5, "semester", term)["status"] == UNACHIEVABLE
    assert goals.plan_grades(3.0, "cumulative", term, None)["status"] == INSUFFICIENT


def test_plan_endpoint_saves_nothing():
    from app.main import repo
    u, tok = breakdown_student()
    repo.save_snapshot(u["id"], "transcript", {"courses": [
        {"semester": 1, "course_code": "OLD 100", "course_name": "Earlier terms", "grade_point": 3.0, "ects": 60}]})
    res = client.get("/api/student/goals/plan?target_gpa=3.0", headers=auth(tok))
    assert res.status_code == 200 and res.json()["status"] == "planned"
    assert {c["code"] for c in res.json()["courses"]} == {"PHY 101", "CAL 101"}
    assert client.get("/api/student/goals", headers=auth(tok)).json()["goal"] is None
    assert client.get("/api/student/goals/plan?target_gpa=5", headers=auth(tok)).status_code == 422


# ─── What-if planner shared with the Goals page ──────────────────────
def test_whatif_template_starts_from_sdu_breakdown_and_saves_a_scenario():
    _u, tok = goals_demo_student()
    body = client.get("/api/student/goals", headers=auth(tok)).json()
    pm = next(c for c in body["tracking"]["courses"] if c["course"] == "Project Management")
    assert pm["breakdown_source"] == "sdu" and [a["name"] for a in pm["breakdown"]] == ["Quizzes", "MT", "FIN"]
    url = f"/api/student/grades/whatif/template?course_code={pm['code']}&course=Project Management"
    start = client.get(url, headers=auth(tok)).json()
    assert start["source"] == "sdu" and start["components"][2] == {"name": "FIN", "weight": 0.5, "score": None}
    scenario = [{"name": "Quizzes", "weight": 0.2, "score": 90}, {"name": "MT", "weight": 0.3, "score": 86.7},
                {"name": "FIN", "weight": 0.5, "score": 92}]
    saved = client.put("/api/student/grades/whatif/template", headers=auth(tok), json={"course_code": pm["code"], "components": scenario})
    assert saved.status_code == 200
    again = client.get(url, headers=auth(tok)).json()        # the sidebar planner opens the same scenario
    assert again["source"] == "saved" and again["components"][2]["score"] == 92
    # A scenario never changes what Goals treats as real grades
    after = client.get("/api/student/goals", headers=auth(tok)).json()
    assert next(c for c in after["tracking"]["courses"] if c["course"] == "Project Management")["breakdown"][2]["score"] is None


def test_whatif_template_must_add_up_to_100():
    _u, tok = breakdown_student()
    bad = [{"name": "MT", "weight": 0.3, "score": 80}, {"name": "FIN", "weight": 0.4, "score": None}]
    assert client.put("/api/student/grades/whatif/template", headers=auth(tok),
                      json={"course_code": "PHY 101", "components": bad}).status_code == 400


def goals_demo_student():
    from app.main import repo
    u = repo.create_user("Whatif Demo", f"6{secrets.randbelow(10**8):08d}", "password123")
    tok = token(u["student_id"], "password123")
    client.post("/api/sdu/demo-connect", headers=auth(tok))
    client.post("/api/sdu/sync", headers=auth(tok))
    return u, tok
