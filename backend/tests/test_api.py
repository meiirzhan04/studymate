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
    response = client.get("/api/student/dashboard", headers=auth(token()))
    assert response.status_code == 200
    body = response.json()
    assert body["gpa"]["data_status"] == "available"
    assert all(row["student_id"] == "s1" for row in body["courses"])


def test_student_cannot_open_teacher_area():
    assert client.get("/api/teacher/students", headers=auth(token())).status_code == 403


def test_teacher_scope_hides_unknown_student():
    teacher = token("teacher@univ.edu", "teacher123")
    assert client.get("/api/teacher/students/not-allowed", headers=auth(teacher)).status_code == 404


def test_teacher_analytics_explains_correlation():
    teacher = token("teacher@univ.edu", "teacher123")
    body = client.get("/api/teacher/analytics/attendance-performance", headers=auth(teacher)).json()
    assert len(body["points"]) == 3
    assert "does not prove causation" in body["note"]

