import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import moodle_calendar
from app.main import app, issue_token, repo


URL = ("https://moodle.sdu.edu.kz/calendar/export_execute.php?"
       "preset_what=courses&preset_time=recentupcoming&username=student&authtoken=private-token")


def test_calendar_export_parses_course_due_time_and_skips_duration_events():
    body = "\r\n".join([
        "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:assignment-1",
        "SUMMARY:Project\\, phase 1", "CATEGORIES:INF 451",
        "DTSTART:20261106T120000Z", "DTEND:20261106T120000Z", "END:VEVENT",
        "BEGIN:VEVENT", "UID:lecture-1", "SUMMARY:Lecture",
        "DTSTART:20261106T120000Z", "DTEND:20261106T130000Z", "END:VEVENT", "END:VCALENDAR",
    ])
    items = moodle_calendar.parse_calendar(body)
    assert len(items) == 1
    assert items[0]["title"] == "Project, phase 1"
    assert items[0]["course"] == "INF 451"
    assert items[0]["due_at"] == "2026-11-06T12:00:00+00:00"
    assert not moodle_calendar.valid_export_url(URL.replace("moodle.sdu.edu.kz", "evil.example"))


def test_connect_moodle_calendar_shows_deadline_without_gateway(monkeypatch):
    user = repo.create_user("Moodle Direct", f"moodle_{secrets.token_hex(4)}", "password123")
    repo.save_sdu_connection(user["id"], "portal:fake", time.time() + 3600, "portal")
    headers = {"Authorization": f"Bearer {issue_token(user)}"}
    due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    async def fake_calendar(url):
        assert url == URL
        return [{"id": "assignment-1", "title": "Project", "course": "INF 451",
                 "type": "moodle", "due_at": due, "submitted": None, "url": None}]

    monkeypatch.setattr(moodle_calendar, "fetch_calendar", fake_calendar)
    client = TestClient(app)
    assert client.post("/api/sdu/moodle/connect", json={"calendar_url": URL}, headers=headers).status_code == 200
    result = client.get("/api/sdu/deadlines", headers=headers).json()
    assert result["available"] is True
    assert result["upcoming"][0]["course"] == "INF 451"
    assert "private-token" not in str(result)
    assert client.delete("/api/sdu/moodle/connect", headers=headers).json()["connected"] is False
