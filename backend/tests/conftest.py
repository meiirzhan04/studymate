import os

# Demo SDU data is opt-in; the test-suite relies on it
os.environ.setdefault("ENABLE_DEMO_MODE", "1")

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
