"""
Demo SDU Platform dataset.

Used when the real SDU portal (api-sdu.javazhan.tech) is unreachable, or when a
user explicitly chooses "demo mode". Payload shapes mirror the real
/api/integrations/v1/{profile,schedule,transcript,attendance,grades} responses
so the frontend can render them without any special-casing.

Every payload is tagged with source="demo_mock" so it can never be confused
with real university data.
"""
from __future__ import annotations

from datetime import datetime, timezone

DEMO_ACCESS_TOKEN = "studymate-demo-mode"
DEMO_SCOPE = "demo"
DEMO_SOURCE = "demo_mock"

DEMO_PROFILE = {
    "student_id": "DEMO2026",
    "fullname": "Demo Student",
    "email": "demo.student@studymate.app",
    "faculty": "Engineering and Natural Sciences",
    "program": "Information Systems",
    "course_year": 3,
}

# (letter, grade_point, min_percent) — SDU 4.0 scale
_SCALE = [
    ("A", 4.00, 95), ("A-", 3.67, 90), ("B+", 3.33, 85), ("B", 3.00, 80),
    ("B-", 2.67, 75), ("C+", 2.33, 70), ("C", 2.00, 65), ("C-", 1.67, 60),
    ("D+", 1.33, 55), ("D", 1.00, 50), ("F", 0.00, 0),
]


def _letter(percent: float) -> tuple[str, float]:
    for letter, gp, minimum in _SCALE:
        if percent >= minimum:
            return letter, gp
    return "F", 0.0


# (semester, code, name, ects, percent)
_TRANSCRIPT_ROWS = [
    (1, "CSS 105", "Fundamentals of Programming", 6, 94),
    (1, "MAT 101", "Calculus I", 6, 81),
    (1, "INF 102", "Introduction to Information Systems", 5, 88),
    (1, "HIS 101", "History of Kazakhstan", 5, 90),
    (2, "CSS 106", "Object-Oriented Programming", 6, 86),
    (2, "MAT 102", "Discrete Mathematics", 6, 74),
    (2, "INF 201", "Database Management Systems", 6, 91),
    (2, "ENG 102", "Academic English", 4, 96),
    (3, "CSS 216", "Data Structures and Algorithms", 6, 79),
    (3, "INF 231", "Systems Analysis and Design", 6, 87),
    (3, "MAT 205", "Probability and Statistics", 5, 68),
    (3, "INF 220", "Web Development", 5, 93),
    (4, "INF 305", "Computer Networks", 6, 84),
    (4, "INF 311", "Business Process Modeling", 5, 89),
    (4, "CSS 301", "Operating Systems", 6, 46),
]

# (code, name, weekday, start, end, building, room, teacher, lesson_type, online)
_SCHEDULE_ROWS = [
    ("INF 381", "Project Management", "Monday", "08:30:00", "09:20:00", "Block F", "F203", "Dr. Aigerim Bekova", "Lecture", False),
    ("INF 381", "Project Management", "Wednesday", "10:30:00", "12:20:00", "Block F", "F105", "Dr. Aigerim Bekova", "Practice", False),
    ("INF 352", "Information Security", "Tuesday", "09:30:00", "10:20:00", "Block A", "A301", "Prof. Daniyar Seitkali", "Lecture", False),
    ("INF 352", "Information Security", "Thursday", "13:30:00", "15:20:00", "Block A", "Lab 2", "Prof. Daniyar Seitkali", "Lab", False),
    ("INF 340", "Data Analytics", "Monday", "12:30:00", "13:20:00", None, None, "Dr. Madina Omarova", "Lecture", True),
    ("INF 340", "Data Analytics", "Friday", "10:30:00", "12:20:00", "Block E", "E210", "Dr. Madina Omarova", "Practice", False),
    ("CSS 342", "Mobile Application Development", "Tuesday", "14:30:00", "16:20:00", "Block D", "D108", "Mr. Arman Tulegenov", "Lab", False),
    ("INF 395", "Enterprise Architecture", "Thursday", "08:30:00", "10:20:00", "Block F", "F301", "Dr. Yerlan Kassymov", "Lecture", False),
]

# (lesson, absence_percent)
_ATTENDANCE_ROWS = [
    ("Project Management", 4.0),
    ("Information Security", 9.5),
    ("Data Analytics", 21.0),
    ("Mobile Application Development", 12.0),
    ("Enterprise Architecture", 6.5),
]

# (lesson, ects, current percent)
_CURRENT_GRADES = [
    ("Project Management", 6, 88.0),
    ("Information Security", 6, 81.5),
    ("Data Analytics", 5, 73.0),
    ("Mobile Application Development", 6, 92.0),
    ("Enterprise Architecture", 5, 85.0),
]

_YEAR, _TERM = 2026, 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_demo_connection(conn: dict | None) -> bool:
    return bool(conn) and (conn.get("scope") == DEMO_SCOPE or conn.get("access_token") == DEMO_ACCESS_TOKEN)


def profile() -> dict:
    return {"source": DEMO_SOURCE, "fetched_at": _now(), **DEMO_PROFILE}


def schedule() -> dict:
    items = []
    for code, name, day, start, end, building, room, teacher, kind, online in _SCHEDULE_ROWS:
        items.append({
            "course_code": code, "course_name": name, "section": "01", "lesson_type": kind,
            "weekday": day, "start_time": start, "end_time": end,
            "building": building, "room": room, "teacher": teacher, "is_online": online,
            "year": _YEAR, "term": _TERM,
        })
    return {"source": DEMO_SOURCE, "fetched_at": _now(), "schedule": items}


def transcript(semester: int | None = None, passed: bool | None = None) -> dict:
    courses = []
    for sem, code, name, ects, pct in _TRANSCRIPT_ROWS:
        letter, gp = _letter(pct)
        row = {
            "semester": sem, "course_code": code, "course_name": name,
            "credits": ects, "ects": ects, "grade": float(pct), "grade_percent": float(pct),
            "letter_grade": letter, "grade_point": gp, "passed": pct >= 50,
        }
        if semester is not None and sem != semester:
            continue
        if passed is not None and row["passed"] != passed:
            continue
        courses.append(row)
    return {"source": DEMO_SOURCE, "fetched_at": _now(), "courses": courses}


def attendance() -> dict:
    items = [
        {"lesson": lesson, "year": _YEAR, "term": _TERM, "absence_percent": absence, "updated_at": _now()}
        for lesson, absence in _ATTENDANCE_ROWS
    ]
    return {"source": DEMO_SOURCE, "fetched_at": _now(), "attendance": items}


def grades() -> dict:
    items = []
    for lesson, ects, pct in _CURRENT_GRADES:
        letter, _gp = _letter(pct)
        items.append({
            "lesson": lesson, "year": _YEAR, "term": _TERM, "grade": pct,
            "letter_grade": letter, "credits": ects, "ects": ects, "updated_at": _now(),
        })
    return {"source": DEMO_SOURCE, "fetched_at": _now(), "grades": items}


def fetch(endpoint: str, params: dict | None = None) -> tuple[int, dict]:
    """Drop-in replacement for sdu_client.fetch_sdu_data in demo mode."""
    params = params or {}
    endpoint = endpoint.strip("/")
    if endpoint == "profile":
        return 200, profile()
    if endpoint == "schedule":
        return 200, schedule()
    if endpoint == "transcript":
        sem = params.get("semester")
        passed_raw = params.get("passed")
        passed = None if passed_raw is None else str(passed_raw).lower() == "true"
        return 200, transcript(int(sem) if sem is not None else None, passed)
    if endpoint == "attendance":
        return 200, attendance()
    if endpoint == "grades":
        return 200, grades()
    return 404, {"detail": f"Unknown demo endpoint: {endpoint}"}
