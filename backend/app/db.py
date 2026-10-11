"""Database connections: SQLite by default, Postgres when DATABASE_URL is set.

The repository is written in SQLite's dialect. On Postgres every statement is
translated here, so the repository keeps one SQL source for both backends:
  ?                          -> %s  (a literal % becomes %%)
  col = ? COLLATE NOCASE     -> lower(col) = lower(%s)
  INSERT OR IGNORE           -> INSERT ... ON CONFLICT DO NOTHING
  INSERT OR REPLACE INTO t   -> INSERT ... ON CONFLICT (<t's key>) DO UPDATE
  cursor.lastrowid           -> INSERT ... RETURNING id
  GROUP_CONCAT(x, sep)       -> STRING_AGG(x, sep)
Rows behave like sqlite3.Row: row["name"], row[0] and dict(row) all work.
"""
from __future__ import annotations

import os
import re
import sqlite3
from typing import Any, Iterable, Optional

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
BACKEND = "postgres" if DATABASE_URL else "sqlite"

# Conflict targets for INSERT OR REPLACE, i.e. each table's primary key
UPSERT_KEYS: dict[str, tuple[str, ...]] = {
    "deleted_accounts": ("user_id",),
    "sdu_connections": ("user_id",),
    "sdu_oauth_attempts": ("state",),
    "sdu_snapshots": ("user_id", "kind"),
    "students": ("id",),
    "whatif_templates": ("user_id", "course_code"),
}

# Tables with an auto-increment id, so an INSERT can report lastrowid
SERIAL_TABLES = frozenset({
    "assessment_items", "attendance_sessions", "grades", "interventions", "notifications",
    "password_reset_codes", "password_reset_tokens", "study_tasks", "support_messages",
    "support_tickets", "tutoring_requests",
})

_NOCASE_EQ = re.compile(r"([\w.]+)\s*=\s*\?\s+COLLATE NOCASE", re.IGNORECASE)
_INSERT_OR_IGNORE = re.compile(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO", re.IGNORECASE)
_INSERT_OR_REPLACE = re.compile(r"^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]*)\)", re.IGNORECASE)
_INSERT_INTO = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.IGNORECASE)


def translate(sql: str, has_params: bool = True) -> str:
    """SQLite-dialect statement -> Postgres statement."""
    out = sql.strip().rstrip(";")
    if has_params:
        out = out.replace("%", "%%")      # psycopg treats % as a placeholder marker
    out = _NOCASE_EQ.sub(r"lower(\1) = lower(?)", out)
    out = re.sub(r"\s+COLLATE NOCASE", "", out, flags=re.IGNORECASE)
    out = re.sub(r"\bGROUP_CONCAT\(", "STRING_AGG(", out, flags=re.IGNORECASE)

    replace = _INSERT_OR_REPLACE.match(out)
    if replace:
        table, cols = replace.group(1), [c.strip() for c in replace.group(2).split(",")]
        keys = UPSERT_KEYS[table]
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in keys)
        out = re.sub(r"INSERT\s+OR\s+REPLACE\s+INTO", "INSERT INTO", out, count=1, flags=re.IGNORECASE)
        out += f" ON CONFLICT ({', '.join(keys)}) " + (f"DO UPDATE SET {updates}" if updates else "DO NOTHING")
    elif _INSERT_OR_IGNORE.match(out):
        out = _INSERT_OR_IGNORE.sub("INSERT INTO", out, count=1) + " ON CONFLICT DO NOTHING"

    return out.replace("?", "%s")


def translate_schema(script: str) -> str:
    out = re.sub(r"INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY", script, flags=re.IGNORECASE)
    out = re.sub(r"\bREAL\b", "DOUBLE PRECISION", out)     # Postgres REAL is float4: too coarse for timestamps
    out = re.sub(r"\s+COLLATE NOCASE", "", out, flags=re.IGNORECASE)
    # Login identifiers stay unique regardless of case, as with SQLite's NOCASE
    return out + "\nCREATE UNIQUE INDEX IF NOT EXISTS login_identifiers_lower ON login_identifiers (lower(identifier));"


class Row(dict):
    """A dict that also supports positional access, like sqlite3.Row."""

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _row_factory(cursor):
    names = [col.name for col in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values))


class PgCursor:
    def __init__(self, cursor, lastrowid: Optional[int] = None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def fetchone(self):
        return self._cursor.fetchone() if self._cursor.description else None

    def fetchall(self):
        return self._cursor.fetchall() if self._cursor.description else []

    def __iter__(self):
        return iter(self.fetchall())


class PgConnection:
    """Mimics the parts of sqlite3.Connection the repository uses; `with` commits and returns it to the pool."""

    def __init__(self, pool):
        self._pool = pool
        self._conn = pool.getconn()

    def execute(self, sql: str, params: Iterable = ()) -> PgCursor:
        params = tuple(params or ())
        if sql.strip().upper().startswith("PRAGMA"):
            return PgCursor(self._conn.cursor())
        query = translate(sql, has_params=bool(params))
        insert = _INSERT_INTO.match(query)
        wants_id = bool(insert) and insert.group(1) in SERIAL_TABLES and "RETURNING" not in query.upper()
        if wants_id:
            query += " RETURNING id"
        cursor = self._conn.cursor(row_factory=_row_factory)
        cursor.execute(query, params or None)
        if wants_id:
            row = cursor.fetchone()
            return PgCursor(cursor, lastrowid=row[0] if row else None)
        return PgCursor(cursor)

    def executemany(self, sql: str, seq: Iterable[Iterable]) -> PgCursor:
        cursor = self._conn.cursor()
        cursor.executemany(translate(sql), [tuple(p) for p in seq])
        return PgCursor(cursor)

    def executescript(self, script: str) -> None:
        self._conn.execute(translate_schema(script))

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def __enter__(self) -> "PgConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._pool.putconn(self._conn)


_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool
        # prepare_threshold=None: no server-side prepared statements, safe behind Neon's PgBouncer pooler
        _pool = ConnectionPool(
            DATABASE_URL, min_size=1, max_size=5, open=True,
            kwargs={"prepare_threshold": None},
            check=ConnectionPool.check_connection,   # Neon drops idle connections when compute sleeps
        )
    return _pool


def connect_postgres() -> PgConnection:
    return PgConnection(_get_pool())


def connect_sqlite(path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def describe() -> str:
    """Where the data lives, without leaking credentials."""
    if BACKEND == "postgres":
        host = re.search(r"@([^/:?]+)", DATABASE_URL)
        return f"postgres://{host.group(1) if host else 'unknown-host'}"
    return "sqlite"
