"""Assessment weights for the What-if planner.

SDU's integration API only reports a course total and exposes nothing from
Moodle except deadlines, so known syllabus breakdowns are transcribed here
from the official course syllabi published on moodle.sdu.edu.kz.
"""
from __future__ import annotations

import re
from typing import Optional

SYLLABUS_LABEL = "Course syllabus 2026-27"

# weights as fractions of the final grade; each preset must sum to 1.0
SYLLABUS_PRESETS: dict[str, tuple[tuple[str, float], ...]] = {
    # CSS 216 Mobile Application Development, Moodle course 1576
    "CSS216": (
        ("Homework", 0.2), ("Quiz", 0.2), ("Midterm", 0.2), ("Final Exam", 0.2), ("Final Project", 0.2),
    ),
    # INF 451 Project Management Information Systems, Fall 2026 (all sections)
    "INF451": (
        ("Sprint Deliverables", 0.25), ("Seminar", 0.15), ("Final Project", 0.2), ("Final Exam", 0.4),
    ),
    # MDE 162 Law, Syllabus 2026-27
    "MDE162": (
        ("Attendance", 0.1), ("Quiz", 0.1), ("Homework", 0.1),
        ("Midterm 1", 0.15), ("Midterm 2", 0.15), ("Final", 0.4),
    ),
}

DEFAULT_COMPONENTS: tuple[tuple[str, float], ...] = (("Midterm", 0.3), ("Endterm", 0.3), ("Final exam", 0.4))


def normalize_code(course_code: str) -> str:
    """'INF 451', 'inf451' and 'INF  451' all name the same course."""
    return re.sub(r"\s+", "", course_code or "").upper()


def as_components(pairs: tuple[tuple[str, float], ...]) -> list[dict]:
    return [{"name": name, "weight": weight, "score": None} for name, weight in pairs]


def preset_for(course_code: str) -> Optional[list[dict]]:
    pairs = SYLLABUS_PRESETS.get(normalize_code(course_code))
    return as_components(pairs) if pairs else None
