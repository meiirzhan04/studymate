"""Sprint 4 analytics: subject comparison, strengths, study resources, grade forecast and goals.

Pure functions only: the routes in main.py load the data and pass it in, so every rule here
is testable without a database.
"""
from __future__ import annotations

import math
import statistics
from typing import Optional
from urllib.parse import quote_plus

# Official SDU scale, as printed on the my.sdu.edu.kz transcript: (min percent, letter, grade point)
SDU_SCALE = (
    (95, "A", 4.0), (90, "A-", 3.67), (85, "B+", 3.33), (80, "B", 3.0), (75, "B-", 2.67), (70, "C+", 2.33),
    (65, "C", 2.0), (60, "C-", 1.67), (55, "D+", 1.33), (50, "D", 1.0),
)

STRENGTH_THRESHOLD = 85        # US-15: a strength is a subject above 85%
MAX_STRENGTHS = 2
FORECAST_MIN_COMPLETION = 0.7  # US-17: forecast once 70% of the coursework is graded
CURRENT_FORM_WEIGHT = 0.7      # remaining work follows this term's form more than past terms
DEFAULT_SPREAD = 10.0          # score spread (percentage points) when there is too little history
MIN_SPREAD = 5.0
Z_95 = 1.96


def grade_point(score: float) -> float:
    return next((gp for minimum, _letter, gp in SDU_SCALE if score >= minimum), 0.0)


def letter_for(score: float) -> str:
    return next((letter for minimum, letter, _gp in SDU_SCALE if score >= minimum), "F")


def term_gpa(courses: list[dict]) -> Optional[float]:
    """ECTS-weighted GPA of graded courses; None without graded credits."""
    graded = [c for c in courses if c.get("score") is not None and (c.get("credits") or 0) > 0]
    credits = sum(c["credits"] for c in graded)
    if not credits:
        return None
    return round(sum(grade_point(c["score"]) * c["credits"] for c in graded) / credits, 2)


IN_PROGRESS_LETTERS = {"IP", "I"}


def _number(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ects(course: dict) -> float:
    """ECTS first, local credits as fallback; a real 0 stays 0 (matches frontend gpa.js)."""
    value = course.get("ects") if course.get("ects") is not None else course.get("credits")
    return _number(value) or 0.0


def transcript_gpa(transcript: list[dict]) -> Optional[float]:
    """Cumulative GPA the way the SDU transcript (and the Overview page) computes it."""
    points = credits = 0.0
    for c in transcript or []:
        gp = _number(c.get("grade_point"))
        if gp is None:   # snapshots saved before grade_point was kept: derive it from the percent
            pct = _number(c.get("grade_percent") if c.get("grade_percent") is not None else c.get("grade"))
            gp = grade_point(pct) if pct is not None else None
        ects = _ects(c)
        if gp is None or ects <= 0:
            continue
        points += gp * ects
        credits += ects
    return round(points / credits, 2) if credits else None


def transcript_current_term(transcript: list[dict]) -> list[dict]:
    """Courses of the latest transcript semester while it is still in progress ("IP"), as goal rows."""
    semesters = [int(c["semester"]) for c in transcript or [] if _number(c.get("semester")) is not None]
    if not semesters:
        return []
    latest = [c for c in transcript if _number(c.get("semester")) == max(semesters)]
    in_progress = any(str(c.get("letter_grade") or "").strip().upper() in IN_PROGRESS_LETTERS for c in latest)
    if not in_progress:
        return []
    return [{
        "course": c.get("course_name") or c.get("course_code"), "code": c.get("course_code"),
        "credits": _ects(c), "score": _number(c.get("grade_percent")),
    } for c in latest if c.get("course_code")]


# ─── US-14 / US-15: comparison and strengths ─────────────────────────
def comparison_average(ranked: list[dict]) -> Optional[float]:
    scores = [r["score"] for r in ranked if r.get("score") is not None]
    return round(sum(scores) / len(scores), 1) if scores else None


def strengths(ranked: list[dict]) -> list[dict]:
    """Top subjects above the strength threshold, strongest first; never padded."""
    above = [r for r in ranked if r.get("score") is not None and r["score"] > STRENGTH_THRESHOLD]
    return [{"course": r["course"], "code": r.get("code"), "score": r["score"]}
            for r in sorted(above, key=lambda r: r["score"], reverse=True)[:MAX_STRENGTHS]]


# ─── US-16: study resources for weak subjects ────────────────────────
OCW = "https://ocw.mit.edu"
# (keywords in the course name, OCW course title, OCW slug, practice page or None). First match wins,
# so specific subjects come before broad ones ("Database Systems" must not match "system").
OCW_CATALOG = (
    (("data structure", "algorithm"), "6.006 Introduction to Algorithms",
     "6-006-introduction-to-algorithms-spring-2020", "assignments"),
    (("database", "sql"), "6.830 Database Systems", "6-830-database-systems-fall-2010", "assignments"),
    (("operating system",), "6.828 Operating System Engineering",
     "6-828-operating-system-engineering-fall-2012", "assignments"),
    (("security", "cryptograph"), "6.858 Computer Systems Security",
     "6-858-computer-systems-security-fall-2014", None),
    (("network",), "6.829 Computer Networks", "6-829-computer-networks-fall-2002", "assignments"),
    (("probability", "statistic"), "18.05 Introduction to Probability and Statistics",
     "18-05-introduction-to-probability-and-statistics-spring-2014", "assignments"),
    (("linear algebra",), "18.06 Linear Algebra", "18-06-linear-algebra-spring-2010", "assignments"),
    (("calculus",), "18.01SC Single Variable Calculus", "18-01sc-single-variable-calculus-fall-2010", None),
    (("discrete",), "6.042J Mathematics for Computer Science",
     "6-042j-mathematics-for-computer-science-spring-2015", None),
    (("analytics", "data science", "machine learning"), "15.071 The Analytics Edge",
     "15-071-the-analytics-edge-spring-2017", "assignments"),
    (("project management",), "ESD.36 System Project Management",
     "esd-36-system-project-management-fall-2012", "assignments"),
    (("programming", "python", "java", "object-oriented"), "6.0001 Introduction to Computer Science and Programming in Python",
     "6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016", "assignments"),
    (("software", "web", "mobile"), "6.005 Software Construction", "6-005-software-construction-spring-2016", "problem-sets"),
    (("physics", "mechanics"), "8.01SC Classical Mechanics", "8-01sc-classical-mechanics-fall-2016", "assignments"),
    (("system", "architecture"), "6.033 Computer System Engineering",
     "6-033-computer-system-engineering-spring-2018", None),
)


def study_resources(course: str, topic: Optional[str] = None) -> list[dict]:
    """Lecture videos, a practice set and a library search for one weak subject."""
    name = (course or "").strip()
    lowered = name.lower()
    match = next((entry for entry in OCW_CATALOG if any(k in lowered for k in entry[0])), None)
    if match:
        _keys, title, slug, practice = match
        base = f"{OCW}/courses/{slug}/"
        items = [
            {"kind": "video", "title": f"MIT OCW · {title}", "url": base},
            {"kind": "practice", "title": "Problem sets with solutions" if practice else "Practice problems on the course page",
             "url": f"{base}pages/{practice}/" if practice else base},
        ]
    else:
        items = [{"kind": "video", "title": f"MIT OCW lectures on {name}", "url": f"{OCW}/search/?q={quote_plus(name)}"}]
    query = f"{name} {topic}" if topic else name
    items.append({"kind": "library", "title": "Textbooks in Open Library",
                  "url": f"https://openlibrary.org/search?q={quote_plus(query)}"})
    return items


# ─── US-17: final grade forecast ─────────────────────────────────────
def forecast(components: list[dict], history: Optional[list[float]] = None) -> dict:
    """Projected final percent and a 95% interval from the graded part of a course.

    The remaining weight is expected to follow this term's form, pulled slightly towards the
    student's past results; the interval narrows as more of the course is graded.
    """
    parts = [c for c in components or [] if (c.get("weight") or 0) > 0]
    if len(parts) < 2 or not math.isclose(sum(c["weight"] for c in parts), 1.0, abs_tol=0.005):
        return {"status": "no_breakdown"}
    graded = [c for c in parts if c.get("score") is not None]
    completion = sum(c["weight"] for c in graded)
    completion_pct = round(completion * 100)
    if completion < FORECAST_MIN_COMPLETION - 1e-9:
        return {"status": "insufficient_data", "completion": completion_pct}

    current = sum(c["score"] * c["weight"] for c in graded) / completion
    if completion >= 1 - 1e-9:
        score = round(current, 1)
        return {"status": "final", "completion": 100, "predicted_score": score, "letter": letter_for(score),
                "low": score, "high": score}

    past = [float(h) for h in history or [] if h is not None]
    prior = sum(past) / len(past) if past else current
    expected_rest = CURRENT_FORM_WEIGHT * current + (1 - CURRENT_FORM_WEIGHT) * prior
    predicted = completion * current + (1 - completion) * expected_rest

    sample = [c["score"] for c in graded] + past
    spread = statistics.pstdev(sample) if len(sample) >= 3 else DEFAULT_SPREAD
    half = Z_95 * max(spread, MIN_SPREAD) * (1 - completion)
    low, high = max(0.0, predicted - half), min(100.0, predicted + half)
    return {
        "status": "predicted", "completion": completion_pct,
        "predicted_score": round(predicted, 1), "letter": letter_for(predicted),
        "low": round(low, 1), "high": round(high, 1), "low_letter": letter_for(low), "high_letter": letter_for(high),
    }


# ─── US-18 / US-19: goals and progress ───────────────────────────────
def required_score(target_gpa: float) -> Optional[float]:
    """Lowest percent whose grade point reaches the target; None above the scale."""
    if target_gpa <= 0:
        return 0.0
    tiers = [minimum for minimum, _letter, gp in SDU_SCALE if gp >= target_gpa - 1e-9]
    return float(min(tiers)) if tiers else None


def _ratio_pct(current: Optional[float], target: Optional[float]) -> Optional[int]:
    if current is None or not target:
        return None
    return min(100, round(current / target * 100))


def goal_progress(goal: Optional[dict], courses: list[dict], attendance: Optional[float],
                  cumulative_gpa: Optional[float] = None) -> dict:
    """US-18 required score per course and US-19 '% on track' (current / target, capped at 100).

    Until this term has grades, the GPA is measured by the cumulative GPA (as on the Overview page).
    """
    goal = goal or {}
    target_gpa = goal.get("target_gpa")
    target_att = goal.get("target_attendance")
    course_targets = goal.get("course_targets") or {}
    uniform = required_score(target_gpa) if target_gpa is not None else None

    rows = []
    for c in courses:
        custom = course_targets.get(c["code"])
        target = custom if custom is not None else uniform
        score = c.get("score")
        rows.append({
            "course": c["course"], "code": c["code"], "credits": c.get("credits"), "score": score,
            "target": target, "target_source": "course" if custom is not None else ("gpa" if target is not None else None),
            "gap": round(target - score, 1) if target is not None and score is not None else None,
            "on_track": score >= target if target is not None and score is not None else None,
        })

    current_gpa = term_gpa(courses)
    basis = "term" if current_gpa is not None else ("cumulative" if cumulative_gpa is not None else None)
    if current_gpa is None:
        current_gpa = cumulative_gpa
    tracked = [r for r in rows if r["on_track"] is not None]
    return {
        "gpa": {"current": current_gpa, "basis": basis, "target": target_gpa, "required_score": uniform,
                "on_track_pct": _ratio_pct(current_gpa, target_gpa)},
        "attendance": {"current": attendance, "target": target_att, "on_track_pct": _ratio_pct(attendance, target_att)},
        "courses": rows,
        "courses_on_track": sum(1 for r in tracked if r["on_track"]),
        "courses_tracked": len(tracked),
    }
