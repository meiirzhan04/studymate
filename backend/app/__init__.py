"""StudyMate backend.

Settings come from environment variables. For local work they can also live in a `.env` file (backend/.env or the
repository root, see .env.example), which is read once here, before any module looks at DATABASE_URL.
Variables that are already set always win, and tests switch the file off (STUDYMATE_SKIP_DOTENV) so a developer's
real DATABASE_URL can never be used by the test-suite.
"""
import os
from pathlib import Path


def load_env(folders) -> int:
    """Read `.env` from each folder without overriding real environment variables. Returns how many files were read."""
    try:
        from dotenv import load_dotenv
    except ImportError:          # python-dotenv is optional: plain environment variables still work
        return 0
    return sum(bool(load_dotenv(Path(folder) / ".env", override=False)) for folder in folders)


if not os.getenv("STUDYMATE_SKIP_DOTENV"):
    load_env((Path(__file__).resolve().parents[1], Path(__file__).resolve().parents[2]))
