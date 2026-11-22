"""The features the risk model sees, and how each one is explained to a student.

Everything here is derived from data the app already has (SDU attendance journal, grades,
deadlines). Attendance follows the SDU rules used elsewhere in the backend: a course fails with FX
once absences reach 30% of its class hours (attendance below 70%), and hours the teacher has not
submitted yet ("Not submitted") are kept apart from absences.
"""
from __future__ import annotations

from typing import Optional

ABSENCE_LIMIT_PCT = 30.0          # same limit as repository.ABSENCE_LIMIT (FX at >= 30% absence)

FEATURES = [
    "attendance_pct",       # overall attendance, % of conducted hours attended or excused
    "max_absence_pct",      # worst course: absent hours / all scheduled hours, in %
    "absent_hours",         # total hours missed across courses
    "pending_hours",        # "Not submitted" hours: held, but not yet marked by the teacher
    "avg_grade",            # mean current course score, 0-100
    "min_grade",            # weakest current course score, 0-100
    "grade_trend",          # score change per term (positive = improving)
    "missed_deadlines",     # overdue, not submitted assignments
    "low_grade_courses",    # courses below the 60% pass line
]

DEFAULTS = {
    "attendance_pct": 100.0, "max_absence_pct": 0.0, "absent_hours": 0.0, "pending_hours": 0.0,
    "avg_grade": 75.0, "min_grade": 75.0, "grade_trend": 0.0, "missed_deadlines": 0.0, "low_grade_courses": 0.0,
}

LABELS = {
    "attendance_pct": "Attendance",
    "max_absence_pct": "Highest course absence",
    "absent_hours": "Missed class hours",
    "pending_hours": "'Not submitted' hours",
    "avg_grade": "Average grade",
    "min_grade": "Weakest course grade",
    "grade_trend": "Grade trend",
    "missed_deadlines": "Missed deadlines",
    "low_grade_courses": "Courses below pass mark",
}


def complete(features: dict) -> dict:
    """Fill gaps with neutral defaults so a student with partial data can still be scored."""
    out = {}
    for name in FEATURES:
        value = features.get(name)
        out[name] = float(value) if isinstance(value, (int, float)) and value == value else DEFAULTS[name]
    return out


def vector(features: dict) -> list[float]:
    full = complete(features)
    return [full[name] for name in FEATURES]


def describe(name: str, value: float, increases_risk: bool) -> str:
    """One plain sentence for a feature value, used for the top reasons."""
    v = float(value)
    n = int(round(v))
    if name == "attendance_pct":
        return f"Attendance is {v:.0f}%" + (" (SDU needs 70% in every course)" if increases_risk else "")
    if name == "max_absence_pct":
        return f"Your worst course has {v:.0f}% absence (the FX limit is {ABSENCE_LIMIT_PCT:.0f}%)"
    if name == "absent_hours":
        return f"{n} missed class hour{'s' if n != 1 else ''}"
    if name == "pending_hours":
        return f"{n} 'Not submitted' hour{'s' if n != 1 else ''} that the teacher may still mark as absences"
    if name == "avg_grade":
        return f"Average grade is {v:.0f}%"
    if name == "min_grade":
        return f"Your weakest course is at {v:.0f}%"
    if name == "grade_trend":
        return f"Grades are {'falling' if v < 0 else 'rising'} by {abs(v):.1f} points per term"
    if name == "missed_deadlines":
        return f"{n} missed deadline{'s' if n != 1 else ''}"
    if name == "low_grade_courses":
        return f"{n} course{'s' if n != 1 else ''} below the 60% pass mark"
    return f"{LABELS.get(name, name)}: {v:.1f}"


def describe_helping(name: str, value: float) -> str:
    """One plain sentence for a factor that keeps the risk low."""
    v = float(value)
    n = int(round(v))
    if name == "attendance_pct":
        return f"Attendance is {v:.0f}%" + (": you have not missed classes" if v >= 99.5 else "")
    if name == "max_absence_pct":
        return "No course has any absences" if v < 0.5 else f"Your worst course has only {v:.0f}% absence (the FX limit is {ABSENCE_LIMIT_PCT:.0f}%)"
    if name == "absent_hours":
        return "No missed class hours" if n == 0 else f"Only {n} missed class hour{'s' if n != 1 else ''}"
    if name == "pending_hours":
        return "No 'Not submitted' hours waiting for the teacher" if n == 0 else f"Only {n} 'Not submitted' hour{'s' if n != 1 else ''}"
    if name == "avg_grade":
        return f"Average grade is {v:.0f}%"
    if name == "min_grade":
        return f"Even your weakest course is at {v:.0f}%"
    if name == "grade_trend":
        return f"Grades are rising by {v:.1f} points per term" if v > 0 else "Grades are stable"
    if name == "missed_deadlines":
        return "No missed deadlines" if n == 0 else f"Only {n} missed deadline{'s' if n != 1 else ''}"
    if name == "low_grade_courses":
        return "No course below the 60% pass mark" if n == 0 else f"Only {n} course{'s' if n != 1 else ''} below the pass mark"
    return f"{LABELS.get(name, name)}: {v:.1f}"


def summarize(risk_percent: int, level: str, reasons: list, helping: list, fx: bool = False) -> str:
    """The explanation in one or two sentences."""
    if reasons and (level != "low" or reasons[0]["impact"] >= 5):
        top = reasons[0]["text"].rstrip(".")
        second = reasons[1]["text"].rstrip(".") if len(reasons) > 1 else ""
        extra = f" Also: {second[0].lower() + second[1:]}." if second and not second.startswith(("SDU", "FX")) else (f" Also: {second}." if second else "")
        return f"Your risk is {risk_percent}% ({level}), mainly because {top[0].lower() + top[1:]}.{extra}"
    kept = f" This is mainly because {helping[0]['text'][0].lower() + helping[0]['text'][1:]}." if helping else ""
    return f"Your risk is {risk_percent}% ({level}): no factor is pushing it up right now.{kept}"


def risk_level(risk: float) -> str:
    return "high" if risk >= 0.5 else "medium" if risk >= 0.25 else "low"


def clamp(value: Optional[float], low: float, high: float) -> float:
    return max(low, min(high, float(value)))
