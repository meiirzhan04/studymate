from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def token(identifier="student@univ.edu", password="student123"):
    response = client.post("/api/auth/login", json={"identifier": identifier, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth(value): return {"Authorization": f"Bearer {value}"}


def test_invalid_login_is_generic():
    response = client.post("/api/auth/login", json={"identifier": "student@univ.edu", "password": "wrongxx"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid identifier or password"


def test_student_dashboard_is_scoped_and_calculated():
    response = client.get("/api/student/dashboard", headers=auth(token("240103118", "Student2028")))
    assert response.status_code == 200
    body = response.json()
    assert body["gpa"]["data_status"] == "available"
    assert all(row["student_id"] == "240103118" for row in body["courses"])


def test_student_cannot_open_teacher_area():
    assert client.get("/api/teacher/students", headers=auth(token("240103118", "Student2028"))).status_code == 403


def test_teacher_scope_hides_unknown_student():
    teacher = token("teacher@univ.edu", "teacher123")
    assert client.get("/api/teacher/students/not-allowed", headers=auth(teacher)).status_code == 404


def test_teacher_analytics_explains_correlation():
    teacher = token("teacher@univ.edu", "teacher123")
    body = client.get("/api/teacher/analytics/attendance-performance", headers=auth(teacher)).json()
    assert len(body["points"]) == 3
    assert "does not prove causation" in body["note"]


def test_sdu_student_240103120_login():
    t = token("240103120", "student123")
    res = client.get("/api/student/dashboard", headers=auth(t))
    assert res.status_code == 200
    body = res.json()
    assert all(row["student_id"] == "240103120" for row in body["courses"])


def test_direct_reset_password():
    res = client.post("/api/auth/direct-reset", json={"email": "240103118", "new_password": "testNewPassword456"})
    assert res.status_code == 200
    # verify login with new password
    t = token("240103118", "testNewPassword456")
    assert t is not None
    # reset back to Student2028
    res2 = client.post("/api/auth/direct-reset", json={"email": "240103118", "new_password": "Student2028"})
    assert res2.status_code == 200


def test_teacher_intervention_flow():
    t = token("teacher@univ.edu", "teacher123")
    res = client.post(
        "/api/teacher/students/240103120/interventions",
        headers=auth(t),
        json={"action_type": "Tutoring Recommendation", "notes": "Please attend lab sessions on Wednesdays."}
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True

    # Check that interventions can be listed
    list_res = client.get("/api/teacher/students/240103120/interventions", headers=auth(t))
    assert list_res.status_code == 200
    items = list_res.json()["items"]
    assert any(i["action_type"] == "Tutoring Recommendation" for i in items)

    # Check student receives notification
    st = token("240103120", "student123")
    notifs = client.get("/api/student/notifications", headers=auth(st)).json()["items"]
    assert any("Academic Advisory" in n["title"] for n in notifs)

