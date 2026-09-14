from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
from pathlib import Path


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()


class SQLiteRepository:
    """Small SQLite repository for local development and the current MVP."""

    def __init__(self, database_path: str | None = None):
        default_path = Path(__file__).resolve().parents[1] / "data" / "student_monitoring.db"
        self.path = Path(database_path or os.getenv("SQLITE_PATH", default_path))
        self.path.parent.mkdir(parents=True, exist_ok=True)
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
                """
            )
            if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
                self._seed(db)

    def _seed(self, db):
        users = [
            ("u-student", "Amina Sadyk", "student", "s1", None, "student-salt", "student123"),
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
            ("s1", "Amina Sadyk", "CS-2026", 87.5, 1),
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

