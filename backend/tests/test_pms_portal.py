"""Signing in as a teacher through SDU PMS (app/pms_portal.py), against a fake auth + PMS API."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import pms_portal, sdu_client
from app.main import app, repo

client = TestClient(app)


class FakePms:
    def __init__(self):
        self.password = "pms-secret"
        self.require_2fa = True
        self.requests = []
        self.students = [
            {"student_id": "240103901", "fullname": "Aruzhan Test", "speciality": "IS-24", "attendance": 88.0, "total_grade": 84.5},
            {"student_id": "240103902", "fullname": "Dias Test", "speciality": "CS-24", "absence_percent": 35.0, "total_grade": 52.0},
        ]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        host = request.url.host
        self.requests.append((request.method, host, path))
        body = json.loads(request.content.decode()) if request.content else {}

        if host == "auth.sdu.edu.kz":
            if path == "/login":
                if body.get("client_id") != "pms":
                    return httpx.Response(400, json={"message": "Invalid client_id"})
                if body.get("password") != self.password:
                    return httpx.Response(401, json={"message": "Invalid username or password"})
                if self.require_2fa:
                    return httpx.Response(200, json={
                        "two_factor_required": True,
                        "challenge_token": "chal-1",
                        "masked_email": "t***@sdu.edu.kz",
                        "resend_cooldown_seconds": 60,
                    })
                return httpx.Response(200, json={
                    "access_token": "pms-access-1",
                    "token_type": "Bearer",
                    "refresh_token": "pms-refresh-1",
                    "expires_at": 9999999999,
                })
            if path == "/two-factor/verify":
                if body.get("challenge_token") not in ("chal-1", "chal-2"):
                    return httpx.Response(400, json={"message": "Challenge expired"})
                if body.get("code") != "654321":
                    return httpx.Response(422, json={"message": "Wrong confirmation code"})
                return httpx.Response(200, json={
                    "access_token": "pms-access-1",
                    "token_type": "Bearer",
                    "refresh_token": "pms-refresh-1",
                    "expires_at": 9999999999,
                })
            if path == "/two-factor/resend":
                return httpx.Response(200, json={
                    "challenge_token": "chal-2",
                    "masked_email": "t***@sdu.edu.kz",
                    "resend_cooldown_seconds": 45,
                })
            if path == "/token/refresh":
                if body.get("refresh_token") == "pms-refresh-1":
                    return httpx.Response(200, json={
                        "access_token": "pms-access-2",
                        "token_type": "Bearer",
                        "refresh_token": "pms-refresh-2",
                        "expires_at": 9999999999,
                    })
                return httpx.Response(401, json={"message": "Expired refresh token"})

        if host == "pms-alpha-api.sdu.edu.kz":
            auth_header = request.headers.get("authorization", "")
            if auth_header not in ("Bearer pms-access-1", "Bearer pms-access-2"):
                return httpx.Response(401, json={"message": "Unauthorized"})
            if path == "/1.0.0/session-info":
                return httpx.Response(200, json={"data": {
                    "employeeId": 7701,
                    "roles": ["teacher"],
                    "year": 2026,
                    "term": 1,
                }})
            if path == "/1.0.0/me":
                return httpx.Response(200, json={"data": {"information": {
                    "fullname": "Dr. Aliya Zhunis",
                    "email": "aliya.zhunis@sdu.edu.kz",
                    "username": "aliya.zhunis",
                }}})
            if path == "/1.0.0/academic/courses/my":
                return httpx.Response(200, json={"data": [
                    {"code": "INF 451", "courseTitle": "Project Management", "sections": [{"section_id": 101}]},
                ]})
            if path == "/1.0.0/academic/courses/students":
                return httpx.Response(200, json={"data": self.students})
            if path == "/1.0.0/academic/courses/grades":
                return httpx.Response(200, json={"data": {"students_with_grades": self.students}})
            if path == "/1.0.0/academic/students/my":
                return httpx.Response(200, json={"data": {"students": []}})

        return httpx.Response(404, json={"message": "Not found"})


@pytest.fixture
def pms(monkeypatch):
    fake = FakePms()
    monkeypatch.setenv("ENABLE_PMS_LOGIN", "1")
    monkeypatch.setattr(pms_portal, "TRANSPORT", httpx.MockTransport(fake))
    return fake


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def sign_in_teacher(pms_fake, username: str = "aliya.zhunis") -> dict:
    step = client.post("/api/sdu/pms/login", json={"username": username, "password": pms_fake.password})
    assert step.status_code == 200, step.text
    if step.json().get("verification_required"):
        assert "t***@sdu.edu.kz" in step.json()["notice"]
        step = client.post("/api/sdu/pms/verify", json={"pending": step.json()["pending"], "code": "654321"})
        assert step.status_code == 200, step.text
    return step.json()


def test_pms_login_config_and_disable_flag(monkeypatch):
    monkeypatch.delenv("ENABLE_PMS_LOGIN", raising=False)
    assert client.get("/api/sdu/pms/config").json() == {"enabled": True}
    monkeypatch.setenv("ENABLE_PMS_LOGIN", "0")
    assert client.get("/api/sdu/pms/config").json() == {"enabled": False}
    res = client.post("/api/sdu/pms/login", json={"username": "aliya.zhunis", "password": "x"})
    assert res.status_code == 404


def test_pms_teacher_sign_in_with_2fa_creates_teacher_and_syncs_students(pms):
    data = sign_in_teacher(pms, "aliya.zhunis@sdu.edu.kz")
    assert data["pms_connected"] is True and data["source"] == "pms"
    assert data["user"]["role"] == "teacher"
    assert data["user"]["name"] == "Dr. Aliya Zhunis"
    assert data["user"]["teacher_id"] == "pms-7701"

    conn = repo.get_sdu_connection(data["user"]["id"])
    assert conn["scope"] == "pms"
    assert conn["access_token"].startswith(pms_portal.TOKEN_PREFIX)
    assert pms.password not in conn["access_token"] and "pms-access-1" not in conn["access_token"]

    roster = client.get("/api/teacher/students", headers=auth(data["access_token"])).json()
    assert roster["pms_connected"] is True
    by_id = {s["id"]: s for s in roster["items"]}
    assert "240103901" in by_id and "240103902" in by_id
    assert by_id["240103901"]["attendance"] == 88.0
    assert by_id["240103902"]["attendance"] == 65.0
    assert any(r["type"] == "low_attendance" for r in by_id["240103902"]["risk_factors"])


def test_pms_resend_code_and_direct_login_without_2fa(pms):
    step = client.post("/api/sdu/pms/login", json={"username": "aliya.zhunis", "password": pms.password})
    assert step.status_code == 200 and step.json()["verification_required"] is True

    resent = client.post("/api/sdu/pms/resend", json={"pending": step.json()["pending"]})
    assert resent.status_code == 200 and resent.json()["pending"]
    verified = client.post("/api/sdu/pms/verify", json={"pending": resent.json()["pending"], "code": "654321"})
    assert verified.status_code == 200 and verified.json()["user"]["role"] == "teacher"

    pms.require_2fa = False
    direct = sign_in_teacher(pms, "aliya.zhunis")
    assert direct["user"]["teacher_id"] == "pms-7701"


def test_pms_wrong_password_and_code_return_400_and_local_fallback_works(pms):
    bad = client.post("/api/sdu/pms/login", json={"username": "bad.teacher", "password": "wrong"})
    assert bad.status_code == 400 and "Invalid" in bad.json()["detail"]

    step = client.post("/api/sdu/pms/login", json={"username": "bad.teacher", "password": pms.password})
    wrong_code = client.post("/api/sdu/pms/verify", json={"pending": step.json()["pending"], "code": "000000"})
    assert wrong_code.status_code == 400
    tampered = client.post("/api/sdu/pms/verify", json={"pending": "x" * 40, "code": "123456"})
    assert tampered.status_code == 400

    # Local StudyMate password signs in without touching auth.sdu.edu.kz
    repo.create_user(name="Local Teacher", identifier="local.prof", password="local-prof-pw", role="teacher")
    pms.requests.clear()
    local = client.post("/api/sdu/pms/login", json={"username": "local.prof", "password": "local-prof-pw"})
    assert local.status_code == 200 and local.json()["user"]["role"] == "teacher"
    assert not any(host == "auth.sdu.edu.kz" for _, host, _ in pms.requests)


def test_pms_sync_refreshes_expired_access_token_and_disconnect_skips_oauth(pms, monkeypatch):
    pms.require_2fa = False
    data = sign_in_teacher(pms)
    tok = data["access_token"]

    # Force stored access token to look expired so PMS API triggers /token/refresh
    stale_token = pms_portal.connection_token({
        "access_token": "expired-access",
        "token_type": "Bearer",
        "refresh_token": "pms-refresh-1",
    })
    repo.save_sdu_connection(data["user"]["id"], stale_token, 9999999999, scope="pms")
    pms.students.append({"student_id": "240103903", "fullname": "New Student", "speciality": "IS-24", "attendance": 95.0})

    sync = client.post("/api/sdu/pms/sync", headers=auth(tok))
    assert sync.status_code == 200, sync.text
    assert sync.json()["students_synced"] == 3

    # Disconnect must not call api-sdu revoke_token
    revoked = []
    async def no_revoke(token, client=None):
        revoked.append(token)
    monkeypatch.setattr(sdu_client, "revoke_token", no_revoke)
    assert client.post("/api/sdu/disconnect", headers=auth(tok)).status_code == 200
    assert revoked == []
