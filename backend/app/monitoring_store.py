"""Tables added for the monitoring features (kept apart from the original schema).

attendance_log   one row per class hour read from the SDU journal; `pending` = "Not submitted"
curators         optional curator contact per student, used by the risk e-mail alerts
risk_alert_log   when a risk e-mail was last sent, so nobody is mailed twice a day
risk_history     predicted risk/GPA after each check, so the risk trend can be drawn over time

Written in SQLite's dialect like the rest of the repository; db.py translates it for Postgres/Neon.
No passwords are stored here: only attendance facts and e-mail addresses.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS attendance_log (
    student_id TEXT NOT NULL,
    course_code TEXT NOT NULL,
    session_date TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (student_id, course_code, session_date)
);
CREATE TABLE IF NOT EXISTS curators (
    student_id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_alert_log (
    student_id TEXT PRIMARY KEY,
    risk REAL NOT NULL,
    sent_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    risk REAL NOT NULL,
    predicted_gpa REAL,
    created_at TEXT NOT NULL
);
"""

ATTENDANCE_STATUSES = ("present", "absent", "permitted", "pending", "upcoming")
_ready: set[int] = set()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure(repo) -> None:
    """Create the tables once per repository (and database)."""
    key = id(repo)
    if key in _ready:
        return
    with repo.connect() as db:
        db.executescript(SCHEMA)
        db.commit()
    _ready.add(key)


# ─── attendance log ────────────────────────────────────────────────

def save_attendance_log(repo, student_id: str, items: list | None) -> int:
    """Store every class hour with its status. Returns the number of rows written."""
    if not student_id or not isinstance(items, list):
        return 0
    ensure(repo)
    rows = []
    for item in items:
        code = (item.get("course_code") or item.get("lesson") or "").strip() if isinstance(item, dict) else ""
        for s in (item.get("sessions") or []) if code else []:
            if s.get("date") and s.get("status") in ATTENDANCE_STATUSES:
                rows.append((student_id, code, s["date"], s["status"]))
    if not rows:
        return 0
    codes = sorted({r[1] for r in rows})
    with repo.connect() as db:
        for code in codes:  # a re-sync replaces the course's hours: statuses change as teachers submit
            db.execute("DELETE FROM attendance_log WHERE student_id = ? AND course_code = ?", (student_id, code))
        for row in rows:
            db.execute("INSERT OR IGNORE INTO attendance_log (student_id, course_code, session_date, status) "
                       "VALUES (?, ?, ?, ?)", row)
        db.commit()
    return len(rows)


def attendance_log(repo, student_id: str) -> list[dict]:
    ensure(repo)
    with repo.connect() as db:
        return [dict(r) for r in db.execute(
            "SELECT course_code, session_date, status FROM attendance_log WHERE student_id = ? "
            "ORDER BY course_code, session_date", (student_id,))]


# ─── curators ──────────────────────────────────────────────────────

def set_curator(repo, student_id: str, email: str, name: Optional[str] = None) -> None:
    ensure(repo)
    with repo.connect() as db:
        db.execute("DELETE FROM curators WHERE student_id = ?", (student_id,))
        db.execute("INSERT INTO curators (student_id, name, email) VALUES (?, ?, ?)", (student_id, name, email))
        db.commit()


def get_curator(repo, student_id: str) -> Optional[dict]:
    ensure(repo)
    with repo.connect() as db:
        row = db.execute("SELECT name, email FROM curators WHERE student_id = ?", (student_id,)).fetchone()
        return dict(row) if row else None


def delete_curator(repo, student_id: str) -> None:
    ensure(repo)
    with repo.connect() as db:
        db.execute("DELETE FROM curators WHERE student_id = ?", (student_id,))
        db.commit()


# ─── alert log + risk history ──────────────────────────────────────

def last_alert(repo, student_id: str) -> Optional[dict]:
    ensure(repo)
    with repo.connect() as db:
        row = db.execute("SELECT risk, sent_at FROM risk_alert_log WHERE student_id = ?", (student_id,)).fetchone()
        return dict(row) if row else None


def record_alert(repo, student_id: str, risk: float) -> None:
    ensure(repo)
    with repo.connect() as db:
        db.execute("DELETE FROM risk_alert_log WHERE student_id = ?", (student_id,))
        db.execute("INSERT INTO risk_alert_log (student_id, risk, sent_at) VALUES (?, ?, ?)", (student_id, risk, now()))
        db.commit()


def record_risk(repo, student_id: str, risk: float, predicted_gpa: Optional[float]) -> None:
    ensure(repo)
    with repo.connect() as db:
        db.execute("INSERT INTO risk_history (student_id, risk, predicted_gpa, created_at) VALUES (?, ?, ?, ?)",
                   (student_id, risk, predicted_gpa, now()))
        db.commit()


def risk_history(repo, student_id: str, limit: int = 30) -> list[dict]:
    ensure(repo)
    with repo.connect() as db:
        rows = db.execute("SELECT risk, predicted_gpa, created_at FROM risk_history WHERE student_id = ? "
                          "ORDER BY id DESC LIMIT ?", (student_id, limit)).fetchall()
    return [dict(r) for r in reversed(rows)]
