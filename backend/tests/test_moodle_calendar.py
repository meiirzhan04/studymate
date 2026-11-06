import asyncio
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi.testclient import TestClient

from app import moodle_calendar, sdu_portal
from app.main import app, issue_token, repo


def test_moodle_login_reads_live_action_events(monkeypatch):
    due = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        if request.url.path == "/login/index.php" and request.method == "GET":
            return httpx.Response(200, text='<form id="login"><input name="logintoken" value="csrf123"></form>',
                                  headers={"set-cookie": "MoodleSession=test-session; Path=/; Secure"})
        if request.url.path == "/login/index.php" and request.method == "POST":
            assert b"username=teststudent" in request.content
            assert b"password=secret-password" in request.content
            assert b"logintoken=csrf123" in request.content
            return httpx.Response(302, headers={"location": "/my/"})
        if request.url.path == "/my/":
            assert request.headers.get("cookie") == "MoodleSession=test-session"
            return httpx.Response(200, text='M.cfg = {"sesskey":"session123"};')
        if request.url.path == "/lib/ajax/service.php":
            assert request.url.params["sesskey"] == "session123"
            return httpx.Response(200, json=[{"data": {"events": [
                {"id": 7, "name": "Project", "course": {"shortname": "INF 451"},
                 "timesort": due, "timestart": due - 3600, "modulename": "assign"}
            ], "lastid": 7}}])
        return httpx.Response(404)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(moodle_calendar.httpx, "AsyncClient",
                        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    cookies, items = asyncio.run(moodle_calendar.login("teststudent", "secret-password"))
    assert cookies == {"MoodleSession": "test-session"}
    assert items[0]["course"] == "INF 451"
    assert items[0]["due_at"] == datetime.fromtimestamp(due, timezone.utc).isoformat()
    assert ("POST", "/lib/ajax/service.php") in calls


def test_connect_moodle_credentials_shows_deadline_and_stores_only_cookie(monkeypatch):
    user = repo.create_user("Moodle Direct", f"moodle_{secrets.token_hex(4)}", "password123")
    repo.save_sdu_connection(user["id"], "portal:fake", time.time() + 3600, "portal")
    headers = {"Authorization": f"Bearer {issue_token(user)}"}
    due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    item = {"id": "assignment-1", "title": "Project", "course": "INF 451",
            "type": "assign", "due_at": due, "submitted": False, "url": None}

    async def fake_login(username, password):
        assert (username, password) == ("teststudent", "secret-password")
        return {"MoodleSession": "test-session"}, [item]

    async def fake_deadlines(cookies):
        assert cookies == {"MoodleSession": "test-session"}
        return [item]

    monkeypatch.setattr(moodle_calendar, "login", fake_login)
    monkeypatch.setattr(moodle_calendar, "fetch_deadlines", fake_deadlines)
    client = TestClient(app)
    response = client.post("/api/sdu/moodle/connect", json={"username": "teststudent", "password": "secret-password"}, headers=headers)
    assert response.status_code == 200
    stored = repo.get_moodle_session(user["id"])
    assert sdu_portal.unseal(stored) == {"MoodleSession": "test-session"}
    assert "secret-password" not in stored
    result = client.get("/api/sdu/deadlines", headers=headers).json()
    assert result["available"] is True
    assert result["upcoming"][0]["course"] == "INF 451"
    assert client.delete("/api/sdu/moodle/connect", headers=headers).json()["connected"] is False
