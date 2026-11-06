"""Read a student's private Moodle calendar export without storing a password."""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

MOODLE_HOST = "moodle.sdu.edu.kz"


def valid_export_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        query = parse_qs(url.query)
        return (url.scheme == "https" and url.hostname == MOODLE_HOST and url.port is None
                and url.path == "/calendar/export_execute.php" and bool(query.get("authtoken"))
                and bool(query.get("username")) and not url.username and not url.password
                and not url.fragment and len(value) <= 4096)
    except ValueError:
        return False


def _unescape(value: str) -> str:
    return value.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _date(value: str, key: str) -> str | None:
    try:
        if len(value) == 8:
            parsed = datetime.strptime(value, "%Y%m%d").replace(tzinfo=timezone.utc)
        else:
            parsed = datetime.strptime(value.rstrip("Z"), "%Y%m%dT%H%M%S")
            if value.endswith("Z"):
                parsed = parsed.replace(tzinfo=timezone.utc)
            else:
                tzid = next((part[5:] for part in key.split(";") if part.startswith("TZID=")), "Asia/Almaty")
                parsed = parsed.replace(tzinfo=ZoneInfo(tzid))
        return parsed.isoformat()
    except (ValueError, ZoneInfoNotFoundError):
        return None


def parse_calendar(body: str) -> list[dict]:
    if "BEGIN:VCALENDAR" not in body:
        raise ValueError("Moodle did not return a calendar. Check the export link.")
    lines = []
    for line in body.splitlines():
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    events = []
    event = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            event = {}
        elif line == "END:VEVENT" and event is not None:
            due_key = next((key for key in event if key.startswith("DTSTART")), None)
            end_key = next((key for key in event if key.startswith("DTEND")), None)
            due = _date(event[due_key], due_key) if due_key else None
            end = _date(event[end_key], end_key) if end_key else None
            title = _unescape(event.get("SUMMARY", "")).strip()
            if due and title and (not end or end == due):
                events.append({"id": event.get("UID", f"{title}|{due}"), "title": title,
                               "course": _unescape(event.get("CATEGORIES", "")).strip() or None,
                               "type": "moodle", "due_at": due, "submitted": None,
                               "url": None})
            event = None
        elif event is not None and ":" in line:
            key, value = line.split(":", 1)
            event[key] = value
    events.sort(key=lambda item: item["due_at"])
    return events


async def fetch_calendar(url: str) -> list[dict]:
    if not valid_export_url(url):
        raise ValueError("Paste the private calendar export URL from moodle.sdu.edu.kz.")
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        response = await client.get(url)
    if response.status_code != 200 or len(response.content) > 2_000_000:
        raise ValueError("Moodle calendar is unavailable. Check the export link and try again.")
    return parse_calendar(response.text)
