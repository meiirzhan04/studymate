from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
import time
from pathlib import Path


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
                """
            )
            if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
                self._seed(db)

    def _seed(self, db):
        users = [
            ("u-student", "Meirzhan", "student", "s1", None, "student-salt", "student123"),
            ("u-teacher", "Dr. Nurlan Bek", "teacher", None, "t1", "teacher-salt", "teacher123"),
        ]
        db.executemany(
            "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(uid, name, role, sid, tid, salt, hash_password(password, salt)) for uid, name, role, sid, tid, salt, password in users],
        )
        db.executemany("INSERT INTO login_identifiers VALUES (?, ?)", [
            ("student@univ.edu", "u-student"), ("STU-001", "u-student"), ("teacher@univ.edu", "u-teacher")
        ])
        db.executemany("INSERT INTO students VALUES (?, ?, ?, ?, ?)", [
            ("s1", "Meirzhan", "CS-2026", 87.5, 1),
            ("s2", "Dias Omar", "CS-2026", 68.0, 3),
            ("s3", "Sara Kim", "CS-2026", 96.0, 0),
        ])
        db.executemany("INSERT INTO teacher_scope VALUES (?, ?)", [("t1", "s1"), ("t1", "s2"), ("t1", "s3")])
        db.executemany("INSERT INTO semesters VALUES (?, ?)", [("spring-2026", "Spring 2026"), ("fall-2025", "Fall 2025")])
        grades = [
            ("s1", "spring-2026", "Algorithms", "CS301", 4, [{"name":"Homework","score":86,"weight":.25},{"name":"Midterm","score":78,"weight":.35},{"name":"Project","score":92,"weight":.40}]),
            ("s1", "spring-2026", "Linear Algebra", "MATH210", 3, [{"name":"Problems","score":68,"weight":.30},{"name":"Midterm","score":61,"weight":.30},{"name":"Final","score":74,"weight":.40}]),
            ("s1", "spring-2026", "Databases", "CS240", 4, [{"name":"Labs","score":94,"weight":.35},{"name":"Midterm","score":88,"weight":.30},{"name":"Project","score":91,"weight":.35}]),
            ("s1", "fall-2025", "Programming II", "CS202", 4, [{"name":"Coursework","score":79,"weight":1.0}]),
            ("s2", "spring-2026", "Algorithms", "CS301", 4, [{"name":"Coursework","score":48,"weight":1.0}]),
            ("s3", "spring-2026", "Algorithms", "CS301", 4, [{"name":"Coursework","score":91,"weight":1.0}]),
        ]
        db.executemany("INSERT INTO grades (student_id, semester, course, code, credits, components_json) VALUES (?, ?, ?, ?, ?, ?)", [(*row[:5], json.dumps(row[5])) for row in grades])
        
        # Seed attendance_sessions for s1
        s1_att = []
        for i in range(20):
            status = 'present' if i < 18 else ('excused' if i == 18 else 'absent')
            s1_att.append(("s1", "CS301", f"2026-01-{i+1:02d}", status))
        for i in range(18):
            status = 'present' if i < 14 else 'absent'
            s1_att.append(("s1", "MATH210", f"2026-01-{i+1:02d}", status))
        for i in range(19):
            s1_att.append(("s1", "CS240", f"2026-01-{i+1:02d}", "present"))
            
        s2_att = [("s2", "CS301", "2026-01-01", "present"), ("s2", "CS301", "2026-01-02", "absent")]
        s3_att = [("s3", "CS301", "2026-01-01", "present")]
        db.executemany("INSERT INTO attendance_sessions (student_id, course_code, session_date, status) VALUES (?, ?, ?, ?)", s1_att + s2_att + s3_att)

        # Seed assessment_items
        items = [
            (1, "HW1", 92, 100, 0.25/3, None),
            (1, "HW2", 80, 100, 0.25/3, None),
            (1, "HW3", 86, 100, 0.25/3, None),
            (1, "Midterm", 78, 100, 0.35, "Good understanding of dynamic programming"),
            (1, "Project", 92, 100, 0.40, "Excellent implementation"),
            (2, "Problems", 68, 100, 0.30, None),
            (2, "Midterm", 61, 100, 0.30, "Review matrix operations"),
            (2, "Final", 74, 100, 0.40, None),
            (3, "Labs", 94, 100, 0.35, None),
            (3, "Midterm", 88, 100, 0.30, None),
            (3, "Project", 91, 100, 0.35, "Very clean schema design")
        ]
        db.executemany("INSERT INTO assessment_items (grade_id, name, score, max_score, weight, feedback) VALUES (?, ?, ?, ?, ?, ?)", items)

        # Seed notifications
        notifs = [
            ("s1", "low_grade", "Low Grade Warning", "Your MATH210 midterm score is 61%. Review recommended.", "Linear Algebra", 0, "2026-03-01T10:00:00Z"),
            ("s1", "low_attendance", "Attendance Alert", "Your MATH210 attendance has fallen to 77.8% - approaching the 75% threshold.", "Linear Algebra", 0, "2026-03-02T10:00:00Z")
        ]
        db.executemany("INSERT INTO notifications (student_id, type, title, detail, course, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", notifs)

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
