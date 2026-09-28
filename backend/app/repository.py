from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
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
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    token TEXT NOT NULL UNIQUE,
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
                """
            )
            has_sdu = db.execute("SELECT COUNT(*) FROM users WHERE student_id = '240103118'").fetchone()[0]
            if has_sdu == 0:
                db.execute("PRAGMA foreign_keys = OFF;")
                for table in ['notifications', 'assessment_items', 'attendance_sessions', 'login_attempts', 'grades', 'teacher_scope', 'students', 'login_identifiers', 'users', 'semesters', 'password_reset_tokens']:
                    db.execute(f"DELETE FROM {table}")
                self._seed(db)
            else:
                user_240 = db.execute("SELECT id, password_salt FROM users WHERE student_id = '240103118'").fetchone()
                if user_240:
                    new_h = hash_password("Student2028", user_240["password_salt"])
                    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_h, user_240["id"]))

    def _seed(self, db):
        users = [
            ("u-240103118", "Meirzhan", "student", "240103118", None, "student1-salt", "Student2028"),
            ("u-240103120", "Dias Omar", "student", "240103120", None, "student2-salt", "student123"),
            ("u-teacher", "Dr. Nurlan Bek", "teacher", None, "t1", "teacher-salt", "teacher123"),
        ]
        db.executemany(
            "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(uid, name, role, sid, tid, salt, hash_password(password, salt)) for uid, name, role, sid, tid, salt, password in users],
        )
        db.executemany("INSERT INTO login_identifiers VALUES (?, ?)", [
            ("240103118", "u-240103118"),
            ("240103118@sdu.edu.kz", "u-240103118"),
            ("student@univ.edu", "u-240103118"),
            ("STU-001", "u-240103118"),
            ("240103120", "u-240103120"),
            ("240103120@sdu.edu.kz", "u-240103120"),
            ("STU-002", "u-240103120"),
            ("teacher@univ.edu", "u-teacher"),
        ])
        db.executemany("INSERT INTO students VALUES (?, ?, ?, ?, ?)", [
            ("240103118", "Meirzhan", "CS-2024 (SDU)", 88.5, 1),
            ("240103120", "Dias Omar", "CS-2024 (SDU)", 71.0, 2),
            ("s3", "Sara Kim", "CS-2024 (SDU)", 96.0, 0),
        ])
        db.executemany("INSERT INTO teacher_scope VALUES (?, ?)", [
            ("t1", "240103118"),
            ("t1", "240103120"),
            ("t1", "s3")
        ])
        db.executemany("INSERT INTO semesters VALUES (?, ?)", [
            ("spring-2026", "Spring 2026"),
            ("fall-2025", "Fall 2025")
        ])
        grades = [
            ("240103118", "spring-2026", "Algorithms & Data Structures", "CSS 301", 4, [{"name":"Homework","score":88,"weight":.25},{"name":"Midterm","score":82,"weight":.35},{"name":"Project","score":92,"weight":.40}]),
            ("240103118", "spring-2026", "Linear Algebra", "MAT 210", 3, [{"name":"Problems","score":70,"weight":.30},{"name":"Midterm","score":64,"weight":.30},{"name":"Final","score":75,"weight":.40}]),
            ("240103118", "spring-2026", "Database Systems", "CSS 240", 4, [{"name":"Labs","score":95,"weight":.35},{"name":"Midterm","score":90,"weight":.30},{"name":"Project","score":93,"weight":.35}]),
            ("240103118", "spring-2026", "Web Development", "CSS 260", 3, [{"name":"Practice","score":92,"weight":.30},{"name":"Midterm","score":86,"weight":.30},{"name":"Project","score":94,"weight":.40}]),
            ("240103118", "fall-2025", "Object-Oriented Programming (Java)", "CSS 202", 4, [{"name":"Coursework","score":84,"weight":1.0}]),
            ("240103120", "spring-2026", "Algorithms & Data Structures", "CSS 301", 4, [{"name":"Homework","score":62,"weight":.25},{"name":"Midterm","score":54,"weight":.35},{"name":"Project","score":68,"weight":.40}]),
            ("240103120", "spring-2026", "Linear Algebra", "MAT 210", 3, [{"name":"Problems","score":74,"weight":.30},{"name":"Midterm","score":70,"weight":.30},{"name":"Final","score":78,"weight":.40}]),
            ("240103120", "spring-2026", "Database Systems", "CSS 240", 4, [{"name":"Labs","score":82,"weight":.35},{"name":"Midterm","score":76,"weight":.30},{"name":"Project","score":80,"weight":.35}]),
            ("240103120", "fall-2025", "Object-Oriented Programming (Java)", "CSS 202", 4, [{"name":"Coursework","score":72,"weight":1.0}]),
            ("s3", "spring-2026", "Algorithms & Data Structures", "CSS 301", 4, [{"name":"Coursework","score":94,"weight":1.0}]),
        ]
        db.executemany("INSERT INTO grades (student_id, semester, course, code, credits, components_json) VALUES (?, ?, ?, ?, ?, ?)", [(*row[:5], json.dumps(row[5])) for row in grades])
        
        # Seed attendance_sessions
        s1_att = []
        for i in range(20):
            status = 'present' if i < 19 else 'excused'
            s1_att.append(("240103118", "CSS 301", f"2026-01-{i+1:02d}", status))
        for i in range(18):
            status = 'present' if i < 15 else 'absent'
            s1_att.append(("240103118", "MAT 210", f"2026-01-{i+1:02d}", status))
        for i in range(19):
            s1_att.append(("240103118", "CSS 240", f"2026-01-{i+1:02d}", "present"))
        for i in range(16):
            status = 'present' if i < 15 else 'absent'
            s1_att.append(("240103118", "CSS 260", f"2026-01-{i+1:02d}", status))

        s2_att = []
        for i in range(20):
            status = 'present' if i < 16 else 'absent'
            s2_att.append(("240103120", "CSS 301", f"2026-01-{i+1:02d}", status))
        for i in range(18):
            status = 'present' if i < 16 else 'absent'
            s2_att.append(("240103120", "MAT 210", f"2026-01-{i+1:02d}", status))
        for i in range(19):
            status = 'present' if i < 17 else 'absent'
            s2_att.append(("240103120", "CSS 240", f"2026-01-{i+1:02d}", status))
            
        s3_att = [("s3", "CSS 301", "2026-01-01", "present")]
        db.executemany("INSERT INTO attendance_sessions (student_id, course_code, session_date, status) VALUES (?, ?, ?, ?)", s1_att + s2_att + s3_att)

        # Seed assessment_items for 240103118 (grades 1, 2, 3, 4)
        items = [
            (1, "HW1", 90, 100, 0.25/3, None),
            (1, "HW2", 84, 100, 0.25/3, None),
            (1, "HW3", 90, 100, 0.25/3, None),
            (1, "Midterm", 82, 100, 0.35, "Great dynamic programming solutions"),
            (1, "Project", 92, 100, 0.40, "Full graph algorithms implementation"),
            (2, "Problems", 70, 100, 0.30, None),
            (2, "Midterm", 64, 100, 0.30, "Review matrix operations and eigenvectors"),
            (2, "Final", 75, 100, 0.40, None),
            (3, "Labs", 95, 100, 0.35, None),
            (3, "Midterm", 90, 100, 0.30, None),
            (3, "Project", 93, 100, 0.35, "Very clean 3NF database schema"),
            (4, "Practice", 92, 100, 0.30, None),
            (4, "Midterm", 86, 100, 0.30, None),
            (4, "Project", 94, 100, 0.40, "Responsive frontend and REST integration"),
            # Seed items for 240103120 (grade 6)
            (6, "Homework", 62, 100, 0.25, None),
            (6, "Midterm", 54, 100, 0.35, "Review tree traversals and recursion"),
            (6, "Project", 68, 100, 0.40, "Good attempt, improve time complexity"),
        ]
        db.executemany("INSERT INTO assessment_items (grade_id, name, score, max_score, weight, feedback) VALUES (?, ?, ?, ?, ?, ?)", items)

        # Seed notifications
        notifs = [
            ("240103118", "low_grade", "Low Grade Alert", "Your MAT 210 midterm score is 64%. Tutoring recommended.", "Linear Algebra", 0, "2026-03-01T10:00:00Z"),
            ("240103118", "low_attendance", "Attendance Alert", "Your MAT 210 attendance has 3 unexcused absences. 1 remaining before course drop limit!", "Linear Algebra", 0, "2026-03-05T12:00:00Z"),
            ("240103120", "low_grade", "Academic Warning", "Your CSS 301 midterm score is 54% (below the 60% threshold).", "Algorithms & Data Structures", 0, "2026-03-02T10:00:00Z"),
            ("240103120", "low_attendance", "Attendance Warning", "Your CSS 301 attendance has 4 unexcused absences. Automatic drop risk!", "Algorithms & Data Structures", 0, "2026-03-10T09:00:00Z"),
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

    def get_user_by_email(self, email: str):
        with self.connect() as db:
            row = db.execute(
                """SELECT u.* FROM users u JOIN login_identifiers i ON i.user_id = u.id
                   WHERE i.identifier = ? COLLATE NOCASE""", (email.strip(),)
            ).fetchone()
            if not row:
                return None
            return {key: row[key] for key in ("id", "name", "role", "student_id", "teacher_id")}

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
