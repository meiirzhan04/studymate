import os

# Demo SDU data is opt-in; the test-suite relies on it
os.environ.setdefault("ENABLE_DEMO_MODE", "1")

# TEST_DATABASE_URL runs the same suite on Postgres against a throwaway database.
# The real DATABASE_URL is never used by tests, and the schema is wiped first.
_TEST_DB = os.getenv("TEST_DATABASE_URL", "").strip()
if _TEST_DB:
    import psycopg

    with psycopg.connect(_TEST_DB, autocommit=True) as _conn:
        _conn.execute("DROP SCHEMA public CASCADE")
        _conn.execute("CREATE SCHEMA public")
    os.environ["DATABASE_URL"] = _TEST_DB
else:
    import tempfile

    os.environ.pop("DATABASE_URL", None)
    # A fresh SQLite file per run, so tests never touch backend/data/student_monitoring.db
    os.environ["SQLITE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="studymate-tests-"), "test.db")

import pytest


@pytest.fixture(autouse=True)
def no_real_email(monkeypatch):
    """Tests must never email real people: capture every outgoing email instead."""
    import app.main as main_mod

    sent = []

    def fake_code(to_email, code):
        sent.append(("code", to_email, code))
        return True, "captured by tests"

    def fake_email(to_email, subject, text):
        sent.append(("message", to_email, subject))
        return True, "captured by tests"

    monkeypatch.setattr(main_mod, "send_gmail_code", fake_code)
    monkeypatch.setattr(main_mod, "send_email", fake_email)
    return sent
