from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from . import sdu_mock


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()


class SQLiteRepository:
    """Small SQLite repository for local development and the current MVP."""

    def __init__(self, database_path: str | None = None):
        default_path = Path(__file__).resolve().parents[1] / "data" / "student_monitoring.db"
        candidate = Path(database_path or os.getenv("SQLITE_PATH", str(default_path)))
        try:
            candidate.parent.mkdir(parents=True, exist_ok=True)
            self.path = candidate
        except PermissionError:
            # Fallback to /tmp if the configured path is not writable (e.g. Render without disk)
            fallback = Path("/tmp/student_monitoring.db")
            fallback.parent.mkdir(parents=True, exist_ok=True)
            self.path = fallback
        self._initialize()

    def connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self):
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher')),
                    student_id TEXT, teacher_id TEXT, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS login_identifiers (
                    identifier TEXT PRIMARY KEY COLLATE NOCASE, user_id TEXT NOT NULL REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS students (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, cohort TEXT NOT NULL,
                    attendance REAL, missing_assignments INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS teacher_scope (
                    teacher_id TEXT NOT NULL, student_id TEXT NOT NULL REFERENCES students(id),
                    PRIMARY KEY (teacher_id, student_id)
                );
                CREATE TABLE IF NOT EXISTS semesters (id TEXT PRIMARY KEY, label TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS grades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL REFERENCES students(id),
                    semester TEXT NOT NULL REFERENCES semesters(id), course TEXT NOT NULL, code TEXT NOT NULL,
                    credits INTEGER NOT NULL, components_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS login_attempts (
                    identifier TEXT NOT NULL,
                    attempted_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attendance_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL REFERENCES students(id),
                    course_code TEXT NOT NULL,
                    session_date TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('present','excused','absent'))
                );
                CREATE TABLE IF NOT EXISTS assessment_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    grade_id INTEGER NOT NULL REFERENCES grades(id),
                    name TEXT NOT NULL,
                    score REAL,
                    max_score REAL NOT NULL,
                    weight REAL NOT NULL,
                    feedback TEXT,
                    posted_at TEXT
                );
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL REFERENCES students(id),
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    course TEXT,
                    read INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    token TEXT NOT NULL UNIQUE,
                    expires_at REAL NOT NULL,
                    used INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS password_reset_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL,
                    code TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    used INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS interventions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL REFERENCES students(id),
                    teacher_id TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sdu_oauth_attempts (
                    state TEXT PRIMARY KEY,
                    code_verifier TEXT NOT NULL,
                    user_id TEXT,
                    redirect_uri TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    used INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sdu_connections (
                    user_id TEXT PRIMARY KEY REFERENCES users(id),
                    access_token TEXT NOT NULL,
                    expires_at REAL NOT NULL,
                    scope TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            # Fresh database (e.g. a new Render deploy): seed demo accounts + curriculum
            has_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if has_users == 0:
                self._seed(db)
                return

            # Check if the real SDU Information Systems curriculum is loaded
            has_is = db.execute("SELECT COUNT(*) FROM grades WHERE code = 'CSS 105'").fetchone()[0]
            if has_is == 0:
                self._seed_is_curriculum(db)
            else:
                # Ensure main student account 240103118 exists
                user_240 = db.execute("SELECT id FROM users WHERE student_id = '240103118'").fetchone()
                if not user_240:
                    salt_240 = "student1-salt"
                    h_240 = hash_password("studymate2026", salt_240)
                    db.execute(
                        "INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                        ("u-240103118", "Meirzhan", "student", "240103118", None, salt_240, h_240)
                    )
                    db.execute("INSERT OR IGNORE INTO students VALUES (?, ?, ?, ?, ?)",
                               ("240103118", "Meirzhan", "Information Systems (IS-2024)", 96.0, 0))
                    db.execute("INSERT OR IGNORE INTO teacher_scope VALUES (?, ?)", ("t1", "240103118"))
                for ident in ("240103118", "240103118@sdu.edu.kz", "amirzhanmeirzhan5@gmail.com", "student@univ.edu", "STU-001"):
                    db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (ident, "u-240103118"))

                # Ensure student 240103188 has a dedicated student account
                has_188 = db.execute("SELECT COUNT(*) FROM users WHERE student_id = '240103188'").fetchone()[0]
                if has_188 == 0:
                    salt_188 = "student188-salt"
                    h_188 = hash_password("studymate2026", salt_188)
                    db.execute("INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                               ("u-240103188", "Student 240103188", "student", "240103188", None, salt_188, h_188))
                    db.execute("INSERT OR IGNORE INTO students VALUES (?, ?, ?, ?, ?)",
                               ("240103188", "Student 240103188", "Information Systems (IS-2024)", 94.0, 0))
                    db.execute("INSERT OR IGNORE INTO teacher_scope VALUES (?, ?)", ("t1", "240103188"))
                for ident in ("240103188", "240103188@sdu.edu.kz"):
                    db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (ident, "u-240103188"))

                # Ensure student 240103120 exists
                has_120 = db.execute("SELECT COUNT(*) FROM users WHERE student_id = '240103120'").fetchone()[0]
                if has_120 == 0:
                    salt_120 = "student2-salt"
                    h_120 = hash_password("student123", salt_120)
                    db.execute("INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                               ("u-240103120", "Dias Omar", "student", "240103120", None, salt_120, h_120))
                    db.execute("INSERT OR IGNORE INTO students VALUES (?, ?, ?, ?, ?)",
                               ("240103120", "Dias Omar", "Information Systems (IS-2024)", 88.0, 1))
                    db.execute("INSERT OR IGNORE INTO teacher_scope VALUES (?, ?)", ("t1", "240103120"))
                for ident in ("240103120", "240103120@sdu.edu.kz", "STU-002"):
                    db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (ident, "u-240103120"))

                # Ensure teacher account exists
                has_t = db.execute("SELECT COUNT(*) FROM users WHERE role = 'teacher'").fetchone()[0]
                if has_t == 0:
                    salt_t = "teacher-salt"
                    h_t = hash_password("teacher123", salt_t)
                    db.execute("INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                               ("u-teacher", "Dr. Nurlan Bek", "teacher", None, "t1", salt_t, h_t))
                    db.execute("INSERT OR IGNORE INTO login_identifiers VALUES (?, ?)", ("teacher@univ.edu", "u-teacher"))

    def _seed_is_curriculum(self, db):
        db.execute("PRAGMA foreign_keys = OFF;")
        db.execute("DELETE FROM assessment_items")
        db.execute("DELETE FROM attendance_sessions")
        db.execute("DELETE FROM notifications")
        db.execute("DELETE FROM grades")
        db.execute("DELETE FROM semesters")

        # 1. Semesters (all 8 academic terms)
        semesters = [
            ("spring-2026", "Semester 5 (Spring 2026) · Current (IP)"),
            ("fall-2025", "Semester 4 (Fall 2025)"),
            ("spring-2025", "Semester 3 (Spring 2025)"),
            ("fall-2024", "Semester 2 (Fall 2024)"),
            ("spring-2024", "Semester 1 (Spring 2024)"),
            ("fall-2026", "Semester 6 (Fall 2026) · Upcoming"),
            ("spring-2027", "Semester 7 (Spring 2027) · Upcoming"),
            ("fall-2027", "Semester 8 (Spring 2028) · Senior Project"),
        ]
        db.executemany("INSERT INTO semesters VALUES (?, ?)", semesters)

        db.execute("UPDATE students SET cohort = 'Information Systems (IS-2024)', attendance = 96.0, missing_assignments = 0 WHERE id = '240103118'")
        db.execute("UPDATE students SET cohort = 'Information Systems (IS-2024)', attendance = 94.0, missing_assignments = 0 WHERE id = '240103188'")
        db.execute("UPDATE students SET cohort = 'Information Systems (IS-2024)', attendance = 88.0, missing_assignments = 1 WHERE id = '240103120'")
        db.execute("DELETE FROM attendance_sessions")
        db.execute("DELETE FROM notifications")

        curriculum = [
            # Semester 1 (spring-2024)
            ("spring-2024", "CSS 105", "Fundamentals of Programming", 3, [{"name": "Midterm", "score": 90, "weight": 0.4}, {"name": "Final", "score": 93, "weight": 0.6}]),
            ("spring-2024", "INF 106", "Information and Communication Technologies", 3, [{"name": "Midterm", "score": 70, "weight": 0.4}, {"name": "Final", "score": 75, "weight": 0.6}]),
            ("spring-2024", "MAT 156", "Discrete Mathematics", 4, [{"name": "Midterm", "score": 72, "weight": 0.4}, {"name": "Final", "score": 75, "weight": 0.6}]),
            ("spring-2024", "MDE 160", "Community engagement and value based Society 1", 1, [{"name": "Coursework", "score": 100, "weight": 1.0}]),
            ("spring-2024", "MDE 171", "History of Kazakhstan", 3, [{"name": "Midterm", "score": 80, "weight": 0.4}, {"name": "Final", "score": 83, "weight": 0.6}]),
            ("spring-2024", "MDE 291", "Physical Education 1", 1, [{"name": "Practice", "score": 96, "weight": 1.0}]),
            ("spring-2024", "MDE 190", "Foreign language 1", 3, [{"name": "Midterm", "score": 65, "weight": 0.4}, {"name": "Final", "score": 70, "weight": 0.6}]),
            ("spring-2024", "MDE 283", "Turkish language 1", 3, [{"name": "Midterm", "score": 82, "weight": 0.4}, {"name": "Final", "score": 84, "weight": 0.6}]),

            # Semester 2 (fall-2024)
            ("fall-2024", "CSS 108", "Programming Technologies and Educational Practice", 3, [{"name": "Practice", "score": 70, "weight": 0.4}, {"name": "Final", "score": 75, "weight": 0.6}]),
            ("fall-2024", "INF 329", "Fundamentals of Information Systems", 2, [{"name": "Midterm", "score": 80, "weight": 0.4}, {"name": "Final", "score": 83, "weight": 0.6}]),
            ("fall-2024", "MAT 137", "Mathematics for Information Systems 1", 3, [{"name": "Midterm", "score": 70, "weight": 0.4}, {"name": "Final", "score": 73, "weight": 0.6}]),
            ("fall-2024", "MAT 151", "Linear Algebra", 3, [{"name": "Midterm", "score": 68, "weight": 0.4}, {"name": "Final", "score": 73, "weight": 0.6}]),
            ("fall-2024", "MDE 170", "Community engagement and value based Society 2", 1, [{"name": "Evaluation", "score": 100, "weight": 1.0}]),
            ("fall-2024", "MDE 292", "Physical Education 2", 1, [{"name": "Practice", "score": 95, "weight": 1.0}]),
            ("fall-2024", "MDE 191", "Foreign language 2", 3, [{"name": "Midterm", "score": 75, "weight": 0.4}, {"name": "Final", "score": 78, "weight": 0.6}]),
            ("fall-2024", "MDE 284", "Turkish language 2", 3, [{"name": "Midterm", "score": 72, "weight": 0.4}, {"name": "Final", "score": 75, "weight": 0.6}]),

            # Semester 3 (spring-2025)
            ("spring-2025", "CSS 215", "Introduction to Algorithms", 3, [{"name": "Homework", "score": 96, "weight": 0.3}, {"name": "Midterm", "score": 94, "weight": 0.3}, {"name": "Final", "score": 95, "weight": 0.4}]),
            ("spring-2025", "CSS 217", "Software Architecture and Design Patterns", 3, [{"name": "Labs", "score": 90, "weight": 0.3}, {"name": "Midterm", "score": 85, "weight": 0.3}, {"name": "Project", "score": 86, "weight": 0.4}]),
            ("spring-2025", "CSS 331", "Operating Systems", 3, [{"name": "Labs", "score": 80, "weight": 0.3}, {"name": "Midterm", "score": 75, "weight": 0.3}, {"name": "Final", "score": 79, "weight": 0.4}]),
            ("spring-2025", "INF 203", "Information security", 3, [{"name": "Labs", "score": 75, "weight": 0.3}, {"name": "Midterm", "score": 70, "weight": 0.3}, {"name": "Final", "score": 74, "weight": 0.4}]),
            ("spring-2025", "INF 211", "Educational practice 2", 1, [{"name": "Report", "score": 95, "weight": 1.0}]),
            ("spring-2025", "MAT 138", "Mathematics for Information Systems 2", 3, [{"name": "Midterm", "score": 74, "weight": 0.4}, {"name": "Final", "score": 77, "weight": 0.6}]),
            ("spring-2025", "MDE 293", "Physical Education 3", 1, [{"name": "Attendance", "score": 96, "weight": 1.0}]),
            ("spring-2025", "MDE 115", "Kazakh / Russian language 1", 3, [{"name": "Midterm", "score": 94, "weight": 0.4}, {"name": "Final", "score": 96, "weight": 0.6}]),

            # Semester 4 (fall-2025)
            ("fall-2025", "INF 202", "Database Management Systems 1", 3, [{"name": "Labs", "score": 76, "weight": 0.3}, {"name": "Midterm", "score": 70, "weight": 0.3}, {"name": "Project", "score": 73, "weight": 0.4}]),
            ("fall-2025", "INF 208", "Business in information systems", 3, [{"name": "Case Studies", "score": 80, "weight": 0.3}, {"name": "Midterm", "score": 74, "weight": 0.3}, {"name": "Final", "score": 77, "weight": 0.4}]),
            ("fall-2025", "INF 313", "Computer networks 1", 3, [{"name": "Packet Tracer", "score": 85, "weight": 0.3}, {"name": "Midterm", "score": 80, "weight": 0.3}, {"name": "Final", "score": 81, "weight": 0.4}]),
            ("fall-2025", "MAT 251", "Probability and Mathematical Statistics", 4, [{"name": "Quizzes", "score": 85, "weight": 0.3}, {"name": "Midterm", "score": 80, "weight": 0.3}, {"name": "Final", "score": 84, "weight": 0.4}]),
            ("fall-2025", "MDE 294", "Physical Education 4", 1, [{"name": "Fitness Test", "score": 97, "weight": 1.0}]),
            ("fall-2025", "MDE 116", "Kazakh / Russian language 2", 3, [{"name": "Midterm", "score": 95, "weight": 0.4}, {"name": "Final", "score": 97, "weight": 0.6}]),

            # Semester 5 (spring-2026) - Current Active Semester!
            ("spring-2026", "CSS 280", "Industrial practice 1", 1, [{"name": "Practice Journal", "score": 88, "weight": 1.0}]),
            ("spring-2026", "INF 381", "Project Management information system", 3, [{"name": "Agile Sprints", "score": 88, "weight": 0.25}, {"name": "Midterm", "score": 82, "weight": 0.35}, {"name": "Jira Project", "score": 90, "weight": 0.40}]),
            ("spring-2026", "MDE 153", "Module of Social and Political Knowledge (Cultural Studies)", 1, [{"name": "Essay", "score": 95, "weight": 1.0}]),
            ("spring-2026", "MDE 154", "Module of Social and Political Knowledge (Psychology)", 1, [{"name": "Colloquium", "score": 91, "weight": 1.0}]),
            ("spring-2026", "CSS 216", "Elective 2 (Software Engineering)", 3, [{"name": "Homework", "score": 88, "weight": 0.30}, {"name": "Midterm", "score": 82, "weight": 0.30}, {"name": "Team Project", "score": 90, "weight": 0.40}]),
            ("spring-2026", "MDE 162", "General education elective", 3, [{"name": "Presentations", "score": 92, "weight": 0.30}, {"name": "Midterm", "score": 84, "weight": 0.30}, {"name": "Term Paper", "score": 88, "weight": 0.40}]),
            ("spring-2026", "INF 318", "Elective 3 (Cloud Architecture & Systems)", 3, [{"name": "Cloud Labs", "score": 95, "weight": 0.35}, {"name": "Midterm", "score": 88, "weight": 0.30}, {"name": "DevOps Project", "score": 92, "weight": 0.35}]),
            ("spring-2026", "INF 376", "Elective 4 (Business Intelligence & Data Analysis)", 3, [{"name": "SQL Analytics", "score": 92, "weight": 0.30}, {"name": "Midterm", "score": 85, "weight": 0.30}, {"name": "BI Dashboard", "score": 90, "weight": 0.40}]),

            # Semester 6 (fall-2026) - Upcoming
            ("fall-2026", "INF 395", "Advanced project for information systems", 3, []),
            ("fall-2026", "MDE 151", "Module of Social and Political Knowledge (Political Science)", 1, [{"name": "Evaluation", "score": 87, "weight": 1.0}]),
            ("fall-2026", "MDE 152", "Module of Social and Political Knowledge (Sociology)", 1, [{"name": "Evaluation", "score": 87, "weight": 1.0}]),
            ("fall-2026", "MDE 172", "Philosophy", 3, [{"name": "Midterm", "score": 70, "weight": 0.4}, {"name": "Final", "score": 75, "weight": 0.6}]),
            ("fall-2026", "INF 3XX", "Elective 6 (Mobile Application Development)", 3, []),
            ("fall-2026", "XXX 3XX", "Elective 7 (Big Data Technologies)", 3, []),
            ("fall-2026", "XXX XXX", "Elective 8 (Cybersecurity Principles)", 3, []),

            # Semester 7 (spring-2027)
            ("spring-2027", "CSS 410", "Research tools and methods", 3, []),
            ("spring-2027", "CSS 483", "Industrial practice 2", 3, []),
            ("spring-2027", "INF 4XX", "Elective 9 (Enterprise Information Systems)", 3, []),
            ("spring-2027", "XXX 4XX", "Elective 11 (DevOps & CI/CD Pipelines)", 3, []),
            ("spring-2027", "XXX 4XX", "Elective 10 (Machine Learning for Business)", 3, []),
            ("spring-2027", "XXX XXX", "Elective 12 (IT Auditing & Governance)", 3, []),

            # Semester 8 (fall-2027)
            ("fall-2027", "INF 420", "Senior Project", 5, []),
            ("fall-2027", "INF 459", "Startups Theory", 3, []),
            ("fall-2027", "CSS XXX", "Diploma thesis / Comprehensive exam", 6, []),
            ("fall-2027", "XXX xxx", "Industrial practice 3 / Pre-graduation practice", 3, []),
        ]

        for student_id in ["240103118", "240103188", "240103120"]:
            for sem, code, name, cr, comps in curriculum:
                mod_comps = []
                if comps:
                    for c in comps:
                        s = c["score"]
                        if student_id == "240103188" and s is not None:
                            s = max(65, min(98, s - 2))
                        elif student_id == "240103120" and s is not None:
                            s = max(55, min(95, s - 6))
                        mod_comps.append({"name": c["name"], "score": s, "weight": c["weight"]})

                cur = db.execute(
                    "INSERT INTO grades (student_id, semester, course, code, credits, components_json) VALUES (?, ?, ?, ?, ?, ?)",
                    (student_id, sem, name, code, cr, json.dumps(mod_comps))
                )
                gid = cur.lastrowid
                if sem == "spring-2026" and mod_comps:
                    for c in mod_comps:
                        db.execute(
                            "INSERT INTO assessment_items (grade_id, name, score, max_score, weight, feedback) VALUES (?, ?, ?, ?, ?, ?)",
                            (gid, c["name"], c["score"], 100, c["weight"], "Good progress on coursework")
                        )

        # Seed attendance sessions for semester 5 (spring-2026) courses
        s5_courses = [
            ("CSS 280", 10, 0),
            ("INF 381", 19, 1),
            ("MDE 153", 15, 0),
            ("MDE 154", 15, 0),
            ("CSS 216", 19, 1),
            ("MDE 162", 17, 1),
            ("INF 318", 20, 0),
            ("INF 376", 16, 2),
        ]
        att_rows = []
        for student_id in ["240103118", "240103188", "240103120"]:
            for code, present_cnt, absent_cnt in s5_courses:
                total = present_cnt + absent_cnt
                for i in range(total):
                    status = "present" if i < present_cnt else "absent"
                    if student_id == "240103120" and i == present_cnt - 1 and absent_cnt > 0:
                        status = "absent"
                    att_rows.append((student_id, code, f"2026-02-{i+1:02d}", status))
        db.executemany("INSERT INTO attendance_sessions (student_id, course_code, session_date, status) VALUES (?, ?, ?, ?)", att_rows)

        # Seed realistic notifications for 240103118
        notifs = [
            ("240103118", "info", "Semester 5 Enrollment Confirmed", "Enrolled in 8 courses for Information Systems (IS-2024).", "INF 381", 0, "2026-02-01T09:00:00Z"),
            ("240103118", "info", "Sprint 2 Review Notice", "Project Management (INF 381): Sprint 2 deliverables and Jira backlog submission deadline is Friday.", "INF 381", 0, "2026-03-01T10:00:00Z"),
            ("240103118", "low_attendance", "Attendance Alert", "Business Intelligence (INF 376): 2 unexcused absences recorded. 2 remaining before drop limit!", "INF 376", 0, "2026-03-15T12:00:00Z"),
            ("240103120", "low_attendance", "Attendance Warning", "Business Intelligence (INF 376): 3 unexcused absences recorded. 1 remaining!", "INF 376", 0, "2026-03-12T11:00:00Z"),
        ]
        db.executemany("INSERT INTO notifications (student_id, type, title, detail, course, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", notifs)

        # Seed initial SDU connection for demo student accounts so attendance & schedule are active
        now_iso = datetime.now(timezone.utc).isoformat()
        exp_time = time.time() + 31536000  # 1 year
        for uid in ["u-240103118", "u-240103188", "u-240103120"]:
            db.execute(
                "INSERT OR REPLACE INTO sdu_connections (user_id, access_token, expires_at, scope, updated_at) VALUES (?, ?, ?, ?, ?)",
                (uid, sdu_mock.DEMO_ACCESS_TOKEN, exp_time, sdu_mock.DEMO_SCOPE, now_iso)
            )

    def _seed(self, db):
        users = [
            ("u-240103118", "Meirzhan", "student", "240103118", None, "student1-salt", "studymate2026"),
            ("u-240103188", "Student 240103188", "student", "240103188", None, "student188-salt", "studymate2026"),
            ("u-240103120", "Dias Omar", "student", "240103120", None, "student2-salt", "student123"),
            ("u-teacher", "Dr. Nurlan Bek", "teacher", None, "t1", "teacher-salt", "teacher123"),
        ]
        db.executemany(
            "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(uid, name, role, sid, tid, salt, hash_password(password, salt)) for uid, name, role, sid, tid, salt, password in users],
        )
        db.executemany("INSERT INTO login_identifiers VALUES (?, ?)", [
            ("240103118", "u-240103118"),
            ("amirzhanmeirzhan5@gmail.com", "u-240103118"),
            ("240103118@sdu.edu.kz", "u-240103118"),
            ("student@univ.edu", "u-240103118"),
            ("STU-001", "u-240103118"),
            ("240103188", "u-240103188"),
            ("240103188@sdu.edu.kz", "u-240103188"),
            ("240103120", "u-240103120"),
            ("240103120@sdu.edu.kz", "u-240103120"),
            ("STU-002", "u-240103120"),
            ("teacher@univ.edu", "u-teacher"),
        ])
        db.executemany("INSERT INTO students VALUES (?, ?, ?, ?, ?)", [
            ("240103118", "Meirzhan", "Information Systems (IS-2024)", 96.0, 0),
            ("240103188", "Student 240103188", "Information Systems (IS-2024)", 94.0, 0),
            ("240103120", "Dias Omar", "Information Systems (IS-2024)", 88.0, 1),
            ("s3", "Sara Kim", "Information Systems (IS-2024)", 97.0, 0),
        ])
        db.executemany("INSERT INTO teacher_scope VALUES (?, ?)", [
            ("t1", "240103118"),
            ("t1", "240103188"),
            ("t1", "240103120"),
            ("t1", "s3")
        ])
        self._seed_is_curriculum(db)

    def authenticate(self, identifier: str, password: str):
        with self.connect() as db:
            row = db.execute(
                """SELECT u.* FROM users u JOIN login_identifiers i ON i.user_id = u.id
                   WHERE i.identifier = ? COLLATE NOCASE""", (identifier.strip(),)
            ).fetchone()
        if not row or not hmac.compare_digest(row["password_hash"], hash_password(password, row["password_salt"])):
            return None
        return {key: row[key] for key in ("id", "name", "role", "student_id", "teacher_id")}

    @property
    def students(self):
        with self.connect() as db:
            return {row["id"]: {"id": row["id"], "name": row["name"], "cohort": row["cohort"]} for row in db.execute("SELECT * FROM students")}

    @property
    def teacher_scope(self):
        result = {}
        with self.connect() as db:
            for row in db.execute("SELECT teacher_id, student_id FROM teacher_scope"):
                result.setdefault(row["teacher_id"], set()).add(row["student_id"])
        return result

    @property
    def semesters(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT id, label FROM semesters ORDER BY id DESC")]

    @property
    def grades(self):
        with self.connect() as db:
            return [{**dict(row), "components": json.loads(row["components_json"])} for row in db.execute("SELECT * FROM grades")]

    @property
    def attendance(self):
        with self.connect() as db:
            return {row["id"]: row["attendance"] for row in db.execute("SELECT id, attendance FROM students")}

    @property
    def missing_assignments(self):
        with self.connect() as db:
            return {row["id"]: row["missing_assignments"] for row in db.execute("SELECT id, missing_assignments FROM students")}

    def get_attendance_sessions(self, student_id: str, course_codes: list[str] = None):
        with self.connect() as db:
            if course_codes:
                placeholders = ','.join('?' for _ in course_codes)
                return [dict(r) for r in db.execute(f"SELECT * FROM attendance_sessions WHERE student_id = ? AND course_code IN ({placeholders})", [student_id] + course_codes)]
            return [dict(r) for r in db.execute("SELECT * FROM attendance_sessions WHERE student_id = ?", (student_id,))]

    def get_assessment_items(self, grade_id: int):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM assessment_items WHERE grade_id = ?", (grade_id,))]

    def get_notifications(self, student_id: str):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM notifications WHERE student_id = ? ORDER BY id DESC", (student_id,))]

    def mark_notification_read(self, notification_id: int, student_id: str):
        with self.connect() as db:
            db.execute("UPDATE notifications SET read = 1 WHERE id = ? AND student_id = ?", (notification_id, student_id))
            db.commit()

    def check_brute_force(self, identifier: str) -> bool:
        with self.connect() as db:
            fifteen_mins_ago = time.time() - 900
            count = db.execute("SELECT COUNT(*) FROM login_attempts WHERE identifier = ? COLLATE NOCASE AND attempted_at >= ?", (identifier, fifteen_mins_ago)).fetchone()[0]
            return count >= 5

    def record_attempt(self, identifier: str):
        with self.connect() as db:
            db.execute("INSERT INTO login_attempts (identifier, attempted_at) VALUES (?, ?)", (identifier, time.time()))
            db.commit()

    def clear_attempts(self, identifier: str):
        with self.connect() as db:
            db.execute("DELETE FROM login_attempts WHERE identifier = ? COLLATE NOCASE", (identifier,))
            db.commit()

    def get_user_by_email(self, email: str):
        with self.connect() as db:
            row = db.execute(
                """SELECT u.* FROM users u JOIN login_identifiers i ON i.user_id = u.id
                   WHERE i.identifier = ? COLLATE NOCASE""", (email.strip(),)
            ).fetchone()
            if not row:
                return None
            return {key: row[key] for key in ("id", "name", "role", "student_id", "teacher_id")}

    def get_user_by_id(self, user_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT id, name, role, student_id, teacher_id FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return None
            return dict(row)

    def get_email_for_user(self, user_id: str) -> str | None:
        with self.connect() as db:
            row = db.execute(
                """SELECT identifier FROM login_identifiers 
                   WHERE user_id = ? AND identifier LIKE '%@%' 
                   ORDER BY 
                       CASE 
                           WHEN identifier LIKE '%@sdu.edu.kz' THEN 0
                           WHEN identifier LIKE '%@gmail.com' THEN 1 
                           ELSE 2 
                       END, 
                       rowid DESC 
                   LIMIT 1""",
                (user_id,)
            ).fetchone()
            return row["identifier"] if row else None

    def create_reset_token(self, user_id: str, token: str, expires_at: float):
        with self.connect() as db:
            db.execute("DELETE FROM password_reset_tokens WHERE user_id = ? AND used = 0", (user_id,))
            db.execute(
                "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
                (user_id, token, expires_at)
            )
            db.commit()

    def validate_reset_token(self, token: str):
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0",
                (token,)
            ).fetchone()
            if not row:
                return None
            if row["expires_at"] < time.time():
                return None
            return dict(row)

    def use_reset_token_and_update_password(self, token: str, new_password: str):
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0",
                (token,)
            ).fetchone()
            if not row or row["expires_at"] < time.time():
                return False
            user_row = db.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
            if not user_row:
                return False
            new_hash = hash_password(new_password, user_row["password_salt"])
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, row["user_id"]))
            db.execute("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", (row["id"],))
            db.commit()
            return True

    def direct_reset_password(self, email: str, new_password: str):
        user = self.get_user_by_email(email)
        if not user:
            return False
        with self.connect() as db:
            user_row = db.execute("SELECT password_salt FROM users WHERE id = ?", (user["id"],)).fetchone()
            if not user_row:
                return False
            new_hash = hash_password(new_password, user_row["password_salt"])
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user["id"]))
            db.commit()
            return True

    def add_intervention(self, student_id: str, teacher_id: str, action_type: str, notes: str):
        with self.connect() as db:
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                "INSERT INTO interventions (student_id, teacher_id, action_type, notes, created_at) VALUES (?, ?, ?, ?, ?)",
                (student_id, teacher_id, action_type, notes, now)
            )
            db.execute(
                "INSERT INTO notifications (student_id, type, title, detail, course, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (student_id, "teacher_intervention", f"Academic Advisory: {action_type}", notes, "Academic Advising", 0, now)
            )
            db.commit()
            return True

    def get_interventions(self, student_id: str):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM interventions WHERE student_id = ? ORDER BY id DESC", (student_id,)).fetchall()]

    def create_user(self, name: str, identifier: str, password: str, role: str = "student", cohort: str = "CS-2026", email: str | None = None):
        clean_id = identifier.strip()
        clean_name = name.strip()
        with self.connect() as db:
            existing = db.execute("SELECT user_id FROM login_identifiers WHERE identifier = ? COLLATE NOCASE", (clean_id,)).fetchone()
            if existing:
                raise ValueError("This Student ID already has an account. If you signed up with SDU, sign in with SDU and set a password in Profile.")
            if email and email.strip():
                clean_email = email.strip()
                existing_email = db.execute("SELECT user_id FROM login_identifiers WHERE identifier = ? COLLATE NOCASE", (clean_email,)).fetchone()
                if existing_email:
                    raise ValueError("An account with this email address already exists.")

            user_id = f"u-{secrets.token_hex(6)}"
            salt = secrets.token_hex(8)
            pw_hash = hash_password(password, salt)

            student_id = None
            teacher_id = None

            if role == "student":
                if clean_id.isdigit():
                    student_id = clean_id
                else:
                    while True:
                        cand = f"STU-{secrets.token_hex(4).upper()}"
                        if not db.execute("SELECT 1 FROM students WHERE id = ?", (cand,)).fetchone():
                            student_id = cand
                            break

                db.execute(
                    "INSERT INTO users (id, name, role, student_id, teacher_id, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (user_id, clean_name, "student", student_id, None, salt, pw_hash)
                )
                db.execute("INSERT INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (clean_id, user_id))
                if clean_id.lower() != student_id.lower():
                    db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (student_id, user_id))
                if email and email.strip():
                    db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (email.strip(), user_id))

                db.execute(
                    "INSERT OR REPLACE INTO students (id, name, cohort, attendance, missing_assignments) VALUES (?, ?, ?, ?, ?)",
                    (student_id, clean_name, cohort, 93.5, 0)
                )

                # Link to teacher t1 scope so student appears in teacher dashboard
                db.execute("INSERT OR IGNORE INTO teacher_scope (teacher_id, student_id) VALUES (?, ?)", ("t1", student_id))

                # Create realistic starter courses
                starter_courses = [
                    (student_id, "spring-2026", "Algorithms & Data Structures", "CSS 301", 4, [
                        {"name": "Homework", "score": 88, "weight": 0.25},
                        {"name": "Midterm", "score": 84, "weight": 0.35},
                        {"name": "Project", "score": 92, "weight": 0.40}
                    ]),
                    (student_id, "spring-2026", "Database Systems", "CSS 240", 4, [
                        {"name": "Labs", "score": 95, "weight": 0.35},
                        {"name": "Midterm", "score": 88, "weight": 0.30},
                        {"name": "Project", "score": 91, "weight": 0.35}
                    ]),
                    (student_id, "spring-2026", "Web Development", "CSS 260", 3, [
                        {"name": "Practice", "score": 92, "weight": 0.30},
                        {"name": "Midterm", "score": 87, "weight": 0.30},
                        {"name": "Project", "score": 94, "weight": 0.40}
                    ]),
                    (student_id, "spring-2026", "Linear Algebra", "MAT 210", 3, [
                        {"name": "Problems", "score": 80, "weight": 0.30},
                        {"name": "Midterm", "score": 76, "weight": 0.30},
                        {"name": "Final", "score": 82, "weight": 0.40}
                    ]),
                ]
                for c_sid, c_sem, c_course, c_code, c_cred, c_comps in starter_courses:
                    cur = db.execute(
                        "INSERT INTO grades (student_id, semester, course, code, credits, components_json) VALUES (?, ?, ?, ?, ?, ?)",
                        (c_sid, c_sem, c_course, c_code, c_cred, json.dumps(c_comps))
                    )
                    gid = cur.lastrowid
                    for comp in c_comps:
                        db.execute(
                            "INSERT INTO assessment_items (grade_id, name, score, max_score, weight, feedback) VALUES (?, ?, ?, ?, ?, ?)",
                            (gid, comp["name"], comp["score"], 100, comp["weight"], "Good progress!")
                        )

                # Starter attendance sessions
                for i in range(14):
                    db.execute(
                        "INSERT INTO attendance_sessions (student_id, course_code, session_date, status) VALUES (?, ?, ?, ?)",
                        (student_id, "CSS 301", f"2026-02-{i+1:02d}", "present")
                    )
                    db.execute(
                        "INSERT INTO attendance_sessions (student_id, course_code, session_date, status) VALUES (?, ?, ?, ?)",
                        (student_id, "CSS 240", f"2026-02-{i+1:02d}", "present")
                    )

                # Welcome notification
                now = datetime.now(timezone.utc).isoformat()
                db.execute(
                    "INSERT INTO notifications (student_id, type, title, detail, course, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (student_id, "welcome", f"Welcome to StudyMate, {clean_name}!", "Your personal academic dashboard is ready. Explore your grades, attendance, and What-If calculator.", None, 0, now)
                )

            else:
                teacher_id = f"t-{secrets.randbelow(899) + 100}"
                db.execute(
                    "INSERT INTO users (id, name, role, student_id, teacher_id, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (user_id, clean_name, "teacher", None, teacher_id, salt, pw_hash)
                )
                db.execute("INSERT INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (clean_id, user_id))

            db.commit()
            return {"id": user_id, "name": clean_name, "role": role, "student_id": student_id, "teacher_id": teacher_id}

    def update_user_name(self, user_id: str, new_name: str) -> bool:
        clean_name = new_name.strip()
        if not clean_name:
            return False
        with self.connect() as db:
            user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                return False
            db.execute("UPDATE users SET name = ? WHERE id = ?", (clean_name, user_id))
            if user["student_id"]:
                db.execute("UPDATE students SET name = ? WHERE id = ?", (clean_name, user["student_id"]))
            db.commit()
            return True

    def set_password(self, user_id: str, new_password: str) -> bool:
        with self.connect() as db:
            if not db.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
                return False
            salt = secrets.token_hex(8)
            db.execute(
                "UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?",
                (salt, hash_password(new_password, salt), user_id)
            )
            db.commit()
            return True

    def create_reset_code(self, email: str, code: str, expires_at: float):
        clean_email = email.strip()
        with self.connect() as db:
            db.execute("DELETE FROM password_reset_codes WHERE email = ? COLLATE NOCASE AND used = 0", (clean_email,))
            db.execute(
                "INSERT INTO password_reset_codes (email, code, expires_at, used) VALUES (?, ?, ?, 0)",
                (clean_email, code.strip(), expires_at)
            )
            db.commit()

    def verify_reset_code(self, email: str, code: str) -> bool:
        clean_email = email.strip()
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM password_reset_codes WHERE email = ? COLLATE NOCASE AND code = ? AND used = 0 AND expires_at >= ?",
                (clean_email, code.strip(), time.time())
            ).fetchone()
            return row is not None

    def reset_password_with_code(self, email: str, code: str, new_password: str) -> bool:
        clean_email = email.strip()
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM password_reset_codes WHERE email = ? COLLATE NOCASE AND code = ? AND used = 0 AND expires_at >= ?",
                (clean_email, code.strip(), time.time())
            ).fetchone()
            if not row:
                return False

            user = self.get_user_by_email(clean_email)
            if not user:
                return False

            user_row = db.execute("SELECT password_salt FROM users WHERE id = ?", (user["id"],)).fetchone()
            if not user_row:
                return False

            new_h = hash_password(new_password, user_row["password_salt"])
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_h, user["id"]))
            db.execute("UPDATE password_reset_codes SET used = 1 WHERE id = ?", (row["id"],))
            db.commit()
            return True

    def create_sdu_oauth_attempt(self, state: str, code_verifier: str, redirect_uri: str, user_id: str | None, expires_at: float):
        with self.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO sdu_oauth_attempts (state, code_verifier, user_id, redirect_uri, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)",
                (state, code_verifier, user_id, redirect_uri, expires_at)
            )
            db.commit()

    def get_and_consume_sdu_oauth_attempt(self, state: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM sdu_oauth_attempts WHERE state = ?", (state,)).fetchone()
            if not row:
                return None
            res = dict(row)
            if res["used"] == 1:
                return {"_error": "attempt_replayed", **res}
            if res["expires_at"] < time.time():
                return {"_error": "attempt_expired", **res}
            db.execute("UPDATE sdu_oauth_attempts SET used = 1 WHERE state = ?", (state,))
            db.commit()
            return res

    def save_sdu_connection(self, user_id: str, access_token: str, expires_at: float, scope: str):
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            existing = db.execute("SELECT user_id FROM sdu_connections WHERE user_id = ?", (user_id,)).fetchone()
            if existing:
                db.execute(
                    "UPDATE sdu_connections SET access_token = ?, expires_at = ?, scope = ?, updated_at = ? WHERE user_id = ?",
                    (access_token, expires_at, scope, now, user_id)
                )
            else:
                db.execute(
                    "INSERT INTO sdu_connections (user_id, access_token, expires_at, scope, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, access_token, expires_at, scope, now)
                )
            db.commit()

    def get_sdu_connection(self, user_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT user_id, access_token, expires_at, scope, updated_at FROM sdu_connections WHERE user_id = ?", (user_id,)).fetchone()
            if not row:
                return None
            return dict(row)

    def delete_sdu_connection(self, user_id: str) -> bool:
        with self.connect() as db:
            cur = db.execute("DELETE FROM sdu_connections WHERE user_id = ?", (user_id,))
            db.commit()
            return cur.rowcount > 0

    # ─── Admin panel queries (never return SDU access tokens) ──────
    _DEMO_SQL = "(c.access_token = ? OR c.scope = ? OR lower(c.access_token) LIKE '%demo%' OR lower(c.scope) LIKE '%demo%')"

    def admin_stats(self) -> dict:
        with self.connect() as db:
            def count(sql):
                return db.execute(sql).fetchone()[0]
            return {
                "users": count("SELECT COUNT(*) FROM users"),
                "students": count("SELECT COUNT(*) FROM users WHERE role = 'student'"),
                "teachers": count("SELECT COUNT(*) FROM users WHERE role = 'teacher'"),
                "sdu_connections": count("SELECT COUNT(*) FROM sdu_connections"),
                "notifications": count("SELECT COUNT(*) FROM notifications"),
            }

    def admin_list_users(self, query: str = "", limit: int = 200) -> list[dict]:
        like = f"%{query}%"
        with self.connect() as db:
            rows = db.execute(
                f"""SELECT u.id, u.name, u.role, u.student_id, u.teacher_id,
                           c.expires_at AS sdu_expires_at, {self._DEMO_SQL} AS sdu_demo,
                           (SELECT GROUP_CONCAT(identifier, ', ') FROM login_identifiers i WHERE i.user_id = u.id) AS identifiers
                    FROM users u LEFT JOIN sdu_connections c ON c.user_id = u.id
                    WHERE ? = '' OR u.name LIKE ? OR u.id LIKE ? OR IFNULL(u.student_id, '') LIKE ?
                       OR u.id IN (SELECT user_id FROM login_identifiers WHERE identifier LIKE ?)
                    ORDER BY u.role DESC, u.name LIMIT ?""",
                (sdu_mock.DEMO_ACCESS_TOKEN, sdu_mock.DEMO_SCOPE, query, like, like, like, like, limit)
            ).fetchall()
        items = []
        for r in rows:
            item = {k: r[k] for k in ("id", "name", "role", "student_id", "teacher_id", "identifiers")}
            if r["sdu_expires_at"] is None:
                item["sdu"] = "none"
            elif r["sdu_demo"]:
                item["sdu"] = "demo"
            elif r["sdu_expires_at"] < time.time():
                item["sdu"] = "expired"
            else:
                item["sdu"] = "live"
            items.append(item)
        return items

    def admin_list_sdu_connections(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                f"""SELECT c.user_id, c.expires_at, c.scope, c.updated_at, {self._DEMO_SQL} AS demo, u.name, u.student_id
                    FROM sdu_connections c LEFT JOIN users u ON u.id = c.user_id
                    ORDER BY c.updated_at DESC""",
                (sdu_mock.DEMO_ACCESS_TOKEN, sdu_mock.DEMO_SCOPE)
            ).fetchall()
        now = time.time()
        return [{
            "user_id": r["user_id"], "name": r["name"], "student_id": r["student_id"],
            "scope": r["scope"], "updated_at": r["updated_at"], "expires_at": r["expires_at"],
            "demo": bool(r["demo"]), "expired": r["expires_at"] < now,
        } for r in rows]

    def admin_delete_user(self, user_id: str) -> bool:
        with self.connect() as db:
            if not db.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
                return False
            for table in ("sdu_connections", "password_reset_tokens", "sdu_oauth_attempts", "login_identifiers"):
                db.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            db.commit()
            return True

    def find_or_create_sdu_user(self, student_id: str, fullname: str, email: str | None) -> dict:
        clean_sid = student_id.strip()
        clean_name = fullname.strip() or f"Student {clean_sid}"
        clean_email = email.strip() if email else f"{clean_sid}@sdu.edu.kz"

        with self.connect() as db:
            row = db.execute(
                """SELECT u.id, u.name, u.role, u.student_id, u.teacher_id 
                   FROM users u
                   WHERE u.student_id = ? 
                   OR u.id IN (SELECT user_id FROM login_identifiers WHERE identifier = ? COLLATE NOCASE OR identifier = ? COLLATE NOCASE)""",
                (clean_sid, clean_sid, clean_email)
            ).fetchone()

            if row:
                u = dict(row)
                if not u.get("student_id"):
                    db.execute("UPDATE users SET student_id = ? WHERE id = ?", (clean_sid, u["id"]))
                    u["student_id"] = clean_sid
                if clean_name and (not u.get("name") or u["name"].startswith("Student ")):
                    db.execute("UPDATE users SET name = ? WHERE id = ?", (clean_name, u["id"]))
                    db.execute("UPDATE students SET name = ? WHERE id = ?", (clean_name, clean_sid))
                    u["name"] = clean_name
                db.execute("INSERT OR IGNORE INTO students (id, name, cohort, attendance, missing_assignments) VALUES (?, ?, 'SDU Student', 95.0, 0)",
                           (clean_sid, clean_name))
                db.execute("INSERT OR IGNORE INTO teacher_scope (teacher_id, student_id) VALUES ('t1', ?)", (clean_sid,))
                db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (clean_sid, u["id"]))
                if clean_email:
                    db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (clean_email, u["id"]))
                db.commit()
                return u

            new_uid = f"u-{clean_sid}"
            salt = secrets.token_hex(8)
            random_pw = secrets.token_urlsafe(16)
            pw_hash = hash_password(random_pw, salt)

            db.execute(
                "INSERT INTO users (id, name, role, student_id, teacher_id, password_salt, password_hash) VALUES (?, ?, 'student', ?, NULL, ?, ?)",
                (new_uid, clean_name, clean_sid, salt, pw_hash)
            )
            db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (clean_sid, new_uid))
            if clean_email:
                db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (clean_email, new_uid))

            db.execute(
                "INSERT OR IGNORE INTO students (id, name, cohort, attendance, missing_assignments) VALUES (?, ?, 'SDU Student', 95.0, 0)",
                (clean_sid, clean_name)
            )
            db.execute("INSERT OR IGNORE INTO teacher_scope (teacher_id, student_id) VALUES ('t1', ?)", (clean_sid,))
            db.commit()

            return {"id": new_uid, "name": clean_name, "role": "student", "student_id": clean_sid, "teacher_id": None}

    def sync_sdu_student_data(self, user_id: str, profile: dict, schedule: list | None, grades: list | None, attendance: list | None) -> dict:
        student_id = profile.get("student_id")
        fullname = profile.get("fullname")
        email = profile.get("email")

        with self.connect() as db:
            user = db.execute("SELECT id, name, student_id FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                return {"synced": False, "error": "User not found"}
            sid = user["student_id"] or student_id

            if fullname and (not user["name"] or user["name"].startswith("Student ")):
                db.execute("UPDATE users SET name = ? WHERE id = ?", (fullname, user_id))
                if sid:
                    db.execute("UPDATE students SET name = ? WHERE id = ?", (fullname, sid))

            if email:
                db.execute("INSERT OR IGNORE INTO login_identifiers (identifier, user_id) VALUES (?, ?)", (email, user_id))

            # Sync SDU attendance
            # Note: SDU exposes absence_percent: SDU course absence percentage, not lesson-by-lesson history.
            # Never label absence_percent as attendance percentage. Attendance = 100 - absence_percent.
            if attendance and isinstance(attendance, list):
                valid_att = [item for item in attendance if isinstance(item, dict) and item.get("absence_percent") is not None]
                if valid_att and sid:
                    avg_absence = sum(float(item["absence_percent"]) for item in valid_att) / len(valid_att)
                    overall_att = round(max(0.0, min(100.0, 100.0 - avg_absence)), 1)
                    db.execute("UPDATE students SET attendance = ? WHERE id = ?", (overall_att, sid))

            # Sync SDU grades
            if grades and isinstance(grades, list) and sid:
                for g in grades:
                    if not isinstance(g, dict):
                        continue
                    course_name = g.get("lesson")
                    if not course_name:
                        continue
                    grade_val = g.get("grade")
                    credits_val = g.get("credits") or g.get("ects") or 3
                    code_val = f"SDU-{abs(hash(course_name)) % 900 + 100}"

                    existing_grade = db.execute(
                        "SELECT id, components_json FROM grades WHERE student_id = ? AND course = ?",
                        (sid, course_name)
                    ).fetchone()

                    if existing_grade:
                        if grade_val is not None:
                            comps = [{"name": "Final Grade", "score": float(grade_val), "weight": 1.0}]
                            db.execute(
                                "UPDATE grades SET components_json = ? WHERE id = ?",
                                (json.dumps(comps), existing_grade["id"])
                            )
                    else:
                        comps = [{"name": "Coursework", "score": float(grade_val) if grade_val is not None else 85.0, "weight": 1.0}]
                        db.execute(
                            "INSERT INTO grades (student_id, semester, course, code, credits, components_json) VALUES (?, 'spring-2026', ?, ?, ?, ?)",
                            (sid, course_name, code_val, credits_val, json.dumps(comps))
                        )

            # Record SDU sync notification
            now = datetime.now(timezone.utc).isoformat()
            if sid:
                db.execute(
                    "INSERT INTO notifications (student_id, type, title, detail, course, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
                    (sid, "sdu_sync", "SDU Platform Data Synchronized", "Your profile, schedule, and attendance records were updated from SDU.", "SDU Portal", now)
                )

            db.execute("UPDATE sdu_connections SET updated_at = ? WHERE user_id = ?", (now, user_id))
            db.commit()
            return {"synced": True, "updated_at": now}

