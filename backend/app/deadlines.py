"""Moodle deadlines from the SDU integration API (US-12 / US-13).

The exact response shape of `moodle/deadlines` is not documented, so the
normalizer accepts the common variants and reports only *key names* (never
values) when it can't recognise the payload.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

LIST_KEYS = ("deadlines", "items", "data", "events", "assignments", "results")
TITLE_KEYS = ("title", "name", "assignment", "assignment_name", "activity", "activityname")
COURSE_KEYS = ("course", "course_name", "coursename", "course_title", "lesson", "subject")
DUE_KEYS = ("due_at", "due", "deadline", "duedate", "due_date", "timestart", "time", "date", "end", "timeclose")
TYPE_KEYS = ("type", "kind", "modulename", "category")
SUBMITTED_KEYS = ("submitted", "is_submitted", "completed", "done")
STATUS_KEYS = ("status", "submission_status", "submissionstatus")
SUBMITTED_STATUSES = {"submitted", "done", "completed", "graded", "complete"}
UNSUBMITTED_STATUSES = {"new", "not_submitted", "notsubmitted", "missing", "overdue", "pending", "todo", "open"}


def _first(item: dict, keys: tuple[str, ...]) -> Any:
    for k in keys:
        if item.get(k) not in (None, ""):
            return item[k]
    return None


def _to_datetime(value: Any) -> Optional[datetime]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.strip().isdigit()):
        number = float(value)
        if number > 1e12:          # epoch milliseconds
            number /= 1000
        if number < 1e9:           # not a plausible timestamp
            return None
        return datetime.fromtimestamp(number, tz=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _submitted(item: dict) -> Optional[bool]:
    """True/False only when the payload says so explicitly; None when unknown."""
    flag = _first(item, SUBMITTED_KEYS)
    if isinstance(flag, bool):
        return flag
    status = _first(item, STATUS_KEYS)
    if isinstance(status, str):
        s = status.strip().lower().replace(" ", "_")
        if s in SUBMITTED_STATUSES:
            return True
        if s in UNSUBMITTED_STATUSES:
            return False
    return None


def extract_list(payload: Any) -> Optional[list]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in LIST_KEYS:
            value = payload.get(k)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):          # e.g. {"data": {"items": [...]}}
                inner = extract_list(value)
                if inner is not None:
                    return inner
    return None


def normalize(payload: Any) -> tuple[list[dict], Optional[str]]:
    """(items, problem). `problem` describes an unrecognised shape using key names only."""
    raw = extract_list(payload)
    if raw is None:
        keys = sorted(payload.keys()) if isinstance(payload, dict) else type(payload).__name__
        return [], f"no deadline list found; top-level keys: {keys}"
    items = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            continue
        due = _to_datetime(_first(entry, DUE_KEYS))
        title = _first(entry, TITLE_KEYS)
        if not due or not title:
            continue
        course = _first(entry, COURSE_KEYS)
        if isinstance(course, dict):
            course = _first(course, ("fullname", "name", "shortname", "title"))
        items.append({
            "id": str(entry.get("id") or entry.get("uid") or f"{title}|{due.isoformat()}"),
            "title": str(title),
            "course": str(course) if course else None,
            "type": str(_first(entry, TYPE_KEYS) or "assignment"),
            "due_at": due.isoformat(),
            "submitted": _submitted(entry),
            "url": entry.get("url") if isinstance(entry.get("url"), str) else None,
        })
    if raw and not items:
        first_keys = sorted(raw[0].keys()) if isinstance(raw[0], dict) else type(raw[0]).__name__
        return [], f"deadline items not recognised; item keys: {first_keys}"
    items.sort(key=lambda d: d["due_at"])
    return items, None


def upcoming(items: list[dict], days: int = 7, now: Optional[datetime] = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    horizon = now.timestamp() + days * 86400
    return [d for d in items
            if now.timestamp() <= datetime.fromisoformat(d["due_at"]).timestamp() <= horizon
            and d["submitted"] is not True]


def missed(items: list[dict], now: Optional[datetime] = None) -> list[dict]:
    """Past-due items that the payload explicitly marks as not submitted."""
    now = now or datetime.now(timezone.utc)
    return [d for d in items
            if datetime.fromisoformat(d["due_at"]) < now and d["submitted"] is False]
