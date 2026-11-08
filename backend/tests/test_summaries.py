"""US-20 weekly and US-21 monthly progress summaries."""
import secrets
from datetime import datetime, timedelta, timezone

from app import summaries
from test_api import auth, client, token

NOW = datetime(2026, 11, 8, 20, 0, tzinfo=timezone.utc)


def point(days_ago, attendance, hours, gpa=None, grades=None):
    return {"at": (NOW - timedelta(days=days_ago)).isoformat(), "attendance": attendance, "gpa": gpa,
            "courses": {code: {"course": code, "hours": 45, "present": p, "absent": a, "permitted": e}
                        for code, (p, a, e) in hours.items()},
            "grades": grades or {}}


def grades(*assessments):
    return {"INF101": {"course": "Algorithms", "assessments": [{"name": n, "weight": w, "score": s} for n, w, s in assessments]}}


def test_one_point_per_day_latest_wins():
    h = summaries.add_point([], point(0, 90.0, {}))
    h = summaries.add_point(h, {**point(0, 91.0, {}), "at": (NOW + timedelta(hours=1)).isoformat()})
    h = summaries.add_point(h, point(1, 89.0, {}))
    assert [p["attendance"] for p in h] == [89.0, 91.0]


def test_weekly_attendance_counts_hours_held_this_week():
    history = [point(8, 95.0, {"A": (10, 1, 0), "B": (8, 0, 0)}),
               point(0, 93.3, {"A": (14, 2, 1), "B": (12, 0, 0)})]    # A: 5 attended (1 excused), 1 missed
    s = summaries.build_summary("week", history, [], {}, {}, now=NOW)
    week = s["attendance"]["this_period"]
    assert week["status"] == "ok" and week["attended"] == 9 and week["missed"] == 1 and week["pct"] == 90.0
    assert s["attendance"]["change"] == -1.7
    assert {c["course"]: c["pct"] for c in week["courses"]} == {"A": 83.3, "B": 100.0}


def test_week_over_week_comparison():
    history = [point(15, 96.0, {"A": (2, 2, 0)}), point(8, 95.0, {"A": (8, 4, 0)}),   # last week 6 of 8 = 75%
               point(0, 95.0, {"A": (16, 4, 0)})]                                       # this week 8 of 8
    s = summaries.build_summary("week", history, [], {}, {}, now=NOW)
    assert s["attendance"]["this_period"]["pct"] == 100.0
    assert s["attendance"]["previous_period"]["pct"] == 75.0 and s["attendance"]["period_change"] == 25.0


def test_holiday_week_with_zero_classes_does_not_break():
    history = [point(8, 95.0, {"A": (10, 1, 0)}), point(0, 95.0, {"A": (10, 1, 0)})]
    s = summaries.build_summary("week", history, [], {}, {}, now=NOW)
    assert s["attendance"]["this_period"]["status"] == "no_classes"
    assert "no classes recorded" in s["headline"]


def test_without_an_earlier_point_no_trend_is_invented():
    s = summaries.build_summary("week", [point(0, 95.0, {"A": (10, 1, 0)})], [], {}, {}, now=NOW)
    assert s["has_baseline"] is False and s["attendance"]["change"] is None
    assert s["attendance"]["this_period"]["status"] == "no_baseline"


def test_new_marks_are_assessments_graded_in_the_period():
    before = grades(("MT", 0.3, 80), ("Quiz 3", 0.1, None), ("FIN", 0.6, None))
    after = grades(("MT", 0.3, 80), ("Quiz 3", 0.1, 72), ("FIN", 0.6, None))
    history = [point(8, 95.0, {}, 3.20, before), point(0, 95.0, {}, 3.25, after)]
    s = summaries.build_summary("week", history, [], {}, {}, now=NOW)
    assert s["new_marks"] == [{"course": "Algorithms", "name": "Quiz 3", "score": 72, "weight": 0.1}]
    assert s["gpa"]["change"] == 0.05


def test_grade_notifications_are_used_when_there_is_no_breakdown():
    notes = [{"type": "grade_posted", "title": "New grade posted", "detail": "Law: 78%", "course": "Law",
              "created_at": (NOW - timedelta(days=2)).isoformat()},
             {"type": "grade_posted", "title": "New grade posted", "detail": "Old: 70%", "course": "Old",
              "created_at": (NOW - timedelta(days=20)).isoformat()}]
    s = summaries.build_summary("week", [point(0, 95.0, {})], notes, {}, {}, now=NOW)
    assert [g["detail"] for g in s["grade_updates"]] == ["Law: 78%"]
    assert "1 new mark" in s["headline"]


def test_deadlines_preview_and_missed_in_month():
    due = lambda days: (NOW + timedelta(days=days)).isoformat()
    deadlines = {"available": True,
                 "upcoming": [{"id": 1, "title": "Algorithms Quiz 3", "course": "Algorithms", "due_at": due(2)}],
                 "overdue": [{"id": 2, "title": "Report", "course": "PM", "due_at": due(-3)},
                             {"id": 3, "title": "Old lab", "course": "PM", "due_at": due(-40)}]}
    week = summaries.build_summary("week", [point(0, 95.0, {})], [], deadlines, {}, now=NOW)
    assert [d["title"] for d in week["deadlines"]["upcoming"]] == ["Algorithms Quiz 3"]
    assert "1 deadline in the next 7 days" in week["headline"]
    month = summaries.build_summary("month", [point(0, 95.0, {})], [], deadlines, {}, now=NOW)
    assert [d["title"] for d in month["deadlines"]["missed"]] == ["Report"]


def test_monthly_compliance_warning_below_requirement():
    history = [point(31, 82.0, {"A": (10, 2, 0)}), point(0, 69.0, {"A": (16, 8, 0)})]   # 6 of 12 this month
    s = summaries.build_summary("month", history, [], {}, {}, now=NOW, min_attendance=70.0)
    assert s["attendance"]["below_requirement"] is True and s["attendance"]["this_period"]["pct"] == 50.0
    assert "Warning: attendance is below the 70% SDU requirement." in summaries.as_text(s, "Gauhar")


def test_goals_and_milestones_in_the_monthly_summary():
    tracking = {"gpa": {"target": 3.3, "status": "on_track", "basis": "cumulative"},
                "attendance": {"target": 90.0, "status": "behind"},
                "courses": [{"course": "Algorithms", "target": 90.0, "evaluation": {"status": "achieved"}}]}
    notes = [{"type": "goal", "title": "Course goal achieved", "detail": "Algorithms: Goal secured.",
              "created_at": (NOW - timedelta(days=5)).isoformat()}]
    history = [point(31, 95.0, {}, None, grades(("MT", 0.4, None), ("FIN", 0.6, None))),
               point(0, 95.0, {}, None, grades(("MT", 0.4, 95), ("FIN", 0.6, None)))]
    s = summaries.build_summary("month", history, notes, {}, tracking, now=NOW)
    assert s["goals"]["counts"] == {"on_track": 1, "behind": 1, "achieved": 1}
    assert s["milestones"] == ["MT graded in Algorithms: 95", "Algorithms: Goal secured."]


# ─── API ─────────────────────────────────────────────────────────────
def demo_student():
    from app.main import repo
    u = repo.create_user("Summary Demo", f"3{secrets.randbelow(10**8):08d}", "password123")
    tok = token(u["student_id"], "password123")
    client.post("/api/sdu/demo-connect", headers=auth(tok))
    client.post("/api/sdu/sync", headers=auth(tok))
    return u, tok


def test_summary_endpoint_after_a_sync():
    from app.main import repo
    u, tok = demo_student()
    assert (repo.get_snapshot(u["id"], "progress_history") or {}).get("points")
    week = client.get("/api/student/summary?period=week", headers=auth(tok)).json()
    assert week["period"] == "week" and week["deadlines"]["available"] is True
    assert week["attendance"]["current"] is not None and week["headline"].startswith("This week:")
    month = client.get("/api/student/summary?period=month", headers=auth(tok)).json()
    assert month["period"] == "month" and month["month"] in month["archive"] and "milestones" in month


def test_monthly_archive_and_missing_month():
    from app.main import repo
    u, tok = demo_student()
    repo.save_snapshot(u["id"], "monthly_archive", {"months": {"2026-09": {"period": "month", "headline": "This month: no new marks."}}})
    old = client.get("/api/student/summary?period=month&month=2026-09", headers=auth(tok)).json()
    assert old["archived"] is True and old["headline"] == "This month: no new marks."
    assert client.get("/api/student/summary?period=month&month=2025-01", headers=auth(tok)).status_code == 404


def test_summary_email_goes_to_the_student(no_real_email):
    from app.main import repo
    u, tok = demo_student()
    with repo.connect() as db:
        db.execute("INSERT INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (f"s{u['student_id']}@sdu.edu.kz", u["id"]))
        db.commit()
    res = client.post("/api/student/summary/email?period=week", headers=auth(tok))
    assert res.status_code == 200 and res.json()["to"] == f"s{u['student_id']}@sdu.edu.kz"
    assert no_real_email[-1][0] == "message" and "weekly summary" in no_real_email[-1][2]


def test_summaries_are_for_students_only():
    teacher = token("teacher@univ.edu", "teacher123")
    assert client.get("/api/student/summary", headers=auth(teacher)).status_code == 403
    assert client.get("/api/student/summary").status_code == 401
