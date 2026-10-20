"""Sprint 4: comparison, strengths, study resources, grade forecast and goals (SCRUM-19..24)."""
import json

from app import academics
from test_api import _insights_student, auth, client


def ranked(*scores):
    return [{"course": f"Course {i}", "code": f"C{i}", "score": s} for i, s in enumerate(scores)]


# ─── SCRUM-19 / SCRUM-20 ─────────────────────────────────────────────
def test_comparison_average_skips_missing_scores():
    assert academics.comparison_average(ranked(80, 90, None)) == 85.0
    assert academics.comparison_average([]) is None


def test_strengths_are_top_two_above_85_strongest_first():
    result = academics.strengths(ranked(70, 92, 88, 96))
    assert [s["score"] for s in result] == [96, 92]


def test_strengths_are_never_padded():
    assert [s["score"] for s in academics.strengths(ranked(85, 90, 60))] == [90]   # exactly 85 is not a strength
    assert academics.strengths(ranked(50, 85)) == []


def test_insights_include_average_strengths_and_resources():
    _u, tok = _insights_student({
        "Database Systems": [{"name": "Final", "score": 95, "weight": 1.0}],
        "Web Development": [{"name": "Final", "score": 88, "weight": 1.0}],
        "Calculus": [{"name": "Midterm", "score": 70, "weight": 0.4}, {"name": "Integrals quiz", "score": 40, "weight": 0.6}],
    })
    data = client.get("/api/student/insights", headers=auth(tok)).json()
    assert data["average"] == round((95 + 88 + 52) / 3, 1)
    assert [s["course"] for s in data["strengths"]] == ["Database Systems", "Web Development"]
    kinds = [r["kind"] for r in data["weak_subjects"][0]["resources"]]
    assert kinds == ["video", "practice", "library"]


# ─── SCRUM-21 ────────────────────────────────────────────────────────
def test_resources_match_specific_subjects_before_broad_ones():
    db = academics.study_resources("Database Management Systems")
    assert "6-830-database-systems" in db[0]["url"]
    sec = academics.study_resources("Information Security")
    assert "6-858-computer-systems-security" in sec[0]["url"]
    assert sec[1]["url"] == sec[0]["url"]          # no separate problem-set page for this course


def test_resources_fall_back_to_search_and_include_the_weak_topic():
    items = academics.study_resources("History of Kazakhstan", "Final essay")
    assert items[0]["url"].startswith("https://ocw.mit.edu/search/?q=History+of+Kazakhstan")
    assert items[-1]["url"] == "https://openlibrary.org/search?q=History+of+Kazakhstan+Final+essay"
    assert all(i["url"].startswith("https://") for i in items)


# ─── SCRUM-22 ────────────────────────────────────────────────────────
def test_forecast_needs_a_breakdown():
    assert academics.forecast([{"name": "Final Grade", "score": 80, "weight": 1.0}])["status"] == "no_breakdown"
    assert academics.forecast([])["status"] == "no_breakdown"


def test_forecast_waits_for_70_percent_of_the_coursework():
    parts = [{"name": "Midterm", "score": 80, "weight": 0.4}, {"name": "Final", "score": None, "weight": 0.6}]
    assert academics.forecast(parts) == {"status": "insufficient_data", "completion": 40}


def test_forecast_projects_letter_and_interval():
    parts = [
        {"name": "Quizzes", "score": 90, "weight": 0.3},
        {"name": "Midterm", "score": 80, "weight": 0.4},
        {"name": "Final", "score": None, "weight": 0.3},
    ]
    result = academics.forecast(parts, history=[70, 80, 90])
    current = (90 * 0.3 + 80 * 0.4) / 0.7
    expected = 0.7 * current + 0.3 * (0.7 * current + 0.3 * 80)
    assert result["status"] == "predicted" and result["completion"] == 70
    assert result["predicted_score"] == round(expected, 1)
    assert result["letter"] == academics.letter_for(expected)
    assert result["low"] < result["predicted_score"] < result["high"]


def test_forecast_interval_narrows_as_more_is_graded():
    def width(done_weight):
        parts = [{"name": "Done", "score": 80, "weight": done_weight}, {"name": "Left", "score": None, "weight": 1 - done_weight}]
        r = academics.forecast(parts)
        return r["high"] - r["low"]
    assert width(0.9) < width(0.7)


def test_forecast_of_a_fully_graded_course_is_final():
    parts = [{"name": "Midterm", "score": 90, "weight": 0.5}, {"name": "Final", "score": 96, "weight": 0.5}]
    assert academics.forecast(parts) == {"status": "final", "completion": 100, "predicted_score": 93.0,
                                         "letter": "A-", "low": 93.0, "high": 93.0}


def test_forecast_endpoint_reports_each_current_course():
    _u, tok = _insights_student({
        "Physics": [{"name": "Midterm", "score": 85, "weight": 0.8}, {"name": "Final", "score": None, "weight": 0.2}],
        "Programming": [{"name": "Final Grade", "score": 77, "weight": 1.0}],
    })
    body = client.get("/api/student/forecast", headers=auth(tok)).json()
    by_course = {i["course"]: i["forecast"] for i in body["items"]}
    assert body["min_completion"] == 70
    assert by_course["Physics"]["status"] == "predicted"
    assert by_course["Programming"]["status"] == "no_breakdown"     # SDU-style single running grade


def test_forecast_uses_the_breakdown_saved_in_the_whatif_planner():
    _u, tok = _insights_student({"Programming": [{"name": "Final Grade", "score": 77, "weight": 1.0}]})
    components = [
        {"name": "Labs", "weight": 0.4, "score": 90},
        {"name": "Midterm", "weight": 0.35, "score": 70},
        {"name": "Final", "weight": 0.25, "score": None},
    ]
    res = client.post("/api/student/grades/whatif", headers=auth(tok), json={
        "course_code": "PRO 101", "component_name": "Final", "target_score": 80, "components": components})
    assert res.status_code == 200
    item = client.get("/api/student/forecast", headers=auth(tok)).json()["items"][0]
    assert item["forecast"]["status"] == "predicted" and item["forecast"]["completion"] == 75


# ─── SCRUM-23 / SCRUM-24 ─────────────────────────────────────────────
def test_required_score_follows_the_sdu_step_scale():
    assert academics.required_score(3.8) == 95.0      # only an A (4.0) reaches 3.80 in a single course
    assert academics.required_score(3.0) == 80.0
    assert academics.required_score(3.67) == 90.0


def test_goal_progress_is_current_over_target_capped_at_100():
    courses = [{"course": "A", "code": "A1", "credits": 5, "score": 96}, {"course": "B", "code": "B1", "credits": 5, "score": 82}]
    progress = academics.goal_progress({"target_gpa": 3.8, "target_attendance": 90, "course_targets": {"B1": 80}}, courses, 99.0)
    assert progress["gpa"]["current"] == 3.5
    assert progress["gpa"]["on_track_pct"] == round(3.5 / 3.8 * 100)
    assert progress["attendance"]["on_track_pct"] == 100
    rows = {r["code"]: r for r in progress["courses"]}
    assert rows["A1"]["target"] == 95.0 and rows["A1"]["on_track"] is True
    assert rows["B1"]["target"] == 80 and rows["B1"]["target_source"] == "course" and rows["B1"]["on_track"] is True
    assert progress["courses_on_track"] == 2


def test_goal_progress_without_goal_or_grades_stays_empty():
    progress = academics.goal_progress(None, [], None)
    assert progress["gpa"] == {"current": None, "target": None, "required_score": None, "on_track_pct": None}
    assert progress["courses_tracked"] == 0


def test_goals_are_saved_and_tracked_per_student():
    _u, tok = _insights_student({
        "Physics": [{"name": "Final", "score": 96, "weight": 1.0}],
        "Calculus": [{"name": "Final", "score": 81, "weight": 1.0}],
    })
    empty = client.get("/api/student/goals", headers=auth(tok)).json()
    assert empty["goal"] is None and empty["progress"]["gpa"]["current"] == 3.5

    res = client.put("/api/student/goals", headers=auth(tok),
                     json={"target_gpa": 3.8, "target_attendance": 90, "course_targets": {"CAL 101": 85}})
    assert res.status_code == 200
    body = client.get("/api/student/goals", headers=auth(tok)).json()
    assert body["goal"]["target_gpa"] == 3.8 and body["goal"]["course_targets"] == {"CAL 101": 85}
    rows = {r["course"]: r for r in body["progress"]["courses"]}
    assert rows["Physics"]["target"] == 95.0 and rows["Physics"]["on_track"] is True
    assert rows["Calculus"]["target"] == 85 and rows["Calculus"]["gap"] == 4.0
    assert body["progress"]["gpa"]["on_track_pct"] == 92


def test_goal_input_is_validated():
    _u, tok = _insights_student({"Physics": [{"name": "Final", "score": 70, "weight": 1.0}]})
    assert client.put("/api/student/goals", headers=auth(tok), json={"target_gpa": 4.5}).status_code == 422
    assert client.put("/api/student/goals", headers=auth(tok), json={"target_attendance": 120}).status_code == 422
    assert client.put("/api/student/goals", headers=auth(tok), json={"course_targets": {"PHY 101": 140}}).status_code == 422
    assert client.put("/api/student/goals", headers=auth(tok), json={"course_targets": {"XYZ 999": 80}}).status_code == 400


def test_goals_require_a_student():
    from test_api import token
    teacher = token("teacher@univ.edu", "teacher123")
    assert client.get("/api/student/goals", headers=auth(teacher)).status_code == 403
    assert client.get("/api/student/goals").status_code == 401


def test_saved_goal_round_trips_through_json():
    from app.main import repo
    u, _tok = _insights_student({})
    repo.save_goal(u["id"], None, 85.0, {})
    assert repo.get_goal(u["id"])["target_attendance"] == 85.0
    assert json.loads(json.dumps(repo.get_goal(u["id"])))["course_targets"] == {}


def test_goals_still_load_and_save_after_a_targeted_course_disappears():
    from app.main import repo
    u, tok = _insights_student({
        "Physics": [{"name": "Final", "score": 90, "weight": 1.0}],
        "Calculus": [{"name": "Final", "score": 70, "weight": 1.0}],
    })
    assert client.put("/api/student/goals", headers=auth(tok), json={"course_targets": {"CAL 101": 80}}).status_code == 200
    with repo.connect() as db:     # e.g. a re-sync renamed the course code
        db.execute("DELETE FROM grades WHERE student_id = ? AND course = 'Calculus'", (u["student_id"],))
        db.commit()
    body = client.get("/api/student/goals", headers=auth(tok)).json()
    assert [r["course"] for r in body["progress"]["courses"]] == ["Physics"]
    assert client.put("/api/student/goals", headers=auth(tok), json={"target_gpa": 3.0, "course_targets": {}}).status_code == 200
