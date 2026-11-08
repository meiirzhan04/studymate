"""US-20 / US-21: weekly and monthly progress summaries.

Pure functions only: main.py loads the records and passes them in. A summary compares two
progress points (one saved after each SDU sync, at most one per day): the latest one and the
last one from before the period started. SDU publishes no history of its own, so changes are
only known from the day StudyMate started keeping points; until then the summary says so
instead of inventing a trend.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

HISTORY_LIMIT = 400          # points kept per student (one per day: more than a year)
WEEK, MONTH = 7, 30
GRADE_TYPES = ("grade_posted", "low_grade")


def _parse(at: str) -> datetime:
    value = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def add_point(history: list[dict], point: dict) -> list[dict]:
    """Keep one point per day (the latest wins), oldest first, capped."""
    day = _parse(point["at"]).date()
    kept = [p for p in history or [] if _parse(p["at"]).date() != day]
    kept.append(point)
    kept.sort(key=lambda p: _parse(p["at"]))
    return kept[-HISTORY_LIMIT:]


def _point_before(history: list[dict], moment: datetime) -> Optional[dict]:
    earlier = [p for p in history if _parse(p["at"]) <= moment]
    return earlier[-1] if earlier else None


def _hours(point: Optional[dict]) -> dict:
    return {k: v for k, v in ((point or {}).get("courses") or {}).items()
            if all(v.get(f) is not None for f in ("present", "absent"))}


def attendance_between(start: Optional[dict], end: Optional[dict]) -> dict:
    """Class hours attended and missed between two points; SDU counts excused hours as attended."""
    if not end:
        return {"status": "no_data"}
    if not start:
        return {"status": "no_baseline"}
    before, after = _hours(start), _hours(end)
    courses, attended, missed = [], 0.0, 0.0
    for key, now in after.items():
        was = before.get(key)
        if was is None:
            continue
        a = (now["present"] - was["present"]) + ((now.get("permitted") or 0) - (was.get("permitted") or 0))
        m = now["absent"] - was["absent"]
        if a < 0 or m < 0:          # a re-sync replaced the journal: do not report negative hours
            continue
        if a or m:
            courses.append({"course": now.get("course") or key, "attended": a, "missed": m,
                            "pct": round(a / (a + m) * 100, 1)})
        attended += a
        missed += m
    if not after or not before:
        return {"status": "no_hours"}
    if attended + missed == 0:
        return {"status": "no_classes", "attended": 0, "missed": 0, "courses": []}
    return {"status": "ok", "attended": attended, "missed": missed,
            "pct": round(attended / (attended + missed) * 100, 1), "courses": courses}


def new_marks(start: Optional[dict], end: Optional[dict]) -> list[dict]:
    """Assessment results that appeared between two points (SDU grades page breakdown)."""
    if not start or not end:
        return []
    marks = []
    old_courses = start.get("grades") or {}
    for key, course in (end.get("grades") or {}).items():
        old = {a["name"]: a.get("score") for a in (old_courses.get(key) or {}).get("assessments") or []}
        for a in course.get("assessments") or []:
            if a.get("score") is not None and old.get(a["name"]) is None:
                marks.append({"course": course.get("course") or key, "name": a["name"], "score": a["score"],
                              "weight": a.get("weight")})
    return marks


def _in(items: list[dict], start: datetime, end: datetime, types: tuple[str, ...]) -> list[dict]:
    out = []
    for n in items or []:
        try:
            at = _parse(n["created_at"])
        except (KeyError, ValueError):
            continue
        if n.get("type") in types and start <= at <= end:
            out.append(n)
    return out


def _delta(new: Optional[float], old: Optional[float], digits: int) -> Optional[float]:
    return round(new - old, digits) if new is not None and old is not None else None


def build_summary(period: str, history: list[dict], notifications: list[dict], deadlines: dict,
                  tracking: dict, now: Optional[datetime] = None, min_attendance: float = 70.0) -> dict:
    """Weekly (7 days) or monthly (30 days) summary of grades, attendance, deadlines and goals."""
    now = now or datetime.now(timezone.utc)
    days = MONTH if period == "month" else WEEK
    start, prev_start = now - timedelta(days=days), now - timedelta(days=2 * days)
    history = sorted(history or [], key=lambda p: _parse(p["at"]))
    end_point = history[-1] if history else None
    base = _point_before(history, start)
    prev_base = _point_before(history, prev_start)
    tracked_since = history[0]["at"] if history else None

    this_period = attendance_between(base, end_point)
    last_period = attendance_between(prev_base, base) if base else {"status": "no_baseline"}
    att_now = (end_point or {}).get("attendance")
    gpa_now = (end_point or {}).get("gpa")

    # New marks: assessment results from the SDU breakdown; otherwise the course-total notifications
    marks = new_marks(base, end_point)
    grade_news = [{"course": n.get("course"), "title": n["title"], "detail": n["detail"], "at": n["created_at"]}
                  for n in _in(notifications, start, now, GRADE_TYPES)]
    goal_news = [{"title": n["title"], "detail": n["detail"], "at": n["created_at"]}
                 for n in _in(notifications, start, now, ("goal",))]

    goal_counts: dict[str, int] = {}
    goal_rows = []
    gpa = tracking.get("gpa") or {}
    att = tracking.get("attendance") or {}
    if gpa.get("target") is not None:
        goal_rows.append({"goal": f"Cumulative GPA {gpa['target']:.2f}", "status": gpa.get("status")})
    if att.get("target") is not None:
        goal_rows.append({"goal": f"Attendance {att['target']:g}%", "status": att.get("status")})
    for c in tracking.get("courses") or []:
        if c.get("target") is not None:
            goal_rows.append({"goal": f"{c['course']} {c['target']:g}%", "status": (c.get("evaluation") or {}).get("status")})
    for g in goal_rows:
        goal_counts[g["status"] or "insufficient_data"] = goal_counts.get(g["status"] or "insufficient_data", 0) + 1

    summary = {
        "period": "month" if days == MONTH else "week", "days": days,
        "from": start.isoformat(), "to": now.isoformat(), "tracked_since": tracked_since,
        "has_baseline": base is not None,
        "attendance": {
            "current": att_now,
            "change": _delta(att_now, (base or {}).get("attendance"), 1),
            "this_period": this_period,
            "previous_period": last_period,
            "period_change": _delta(this_period.get("pct"), last_period.get("pct"), 1),
            "below_requirement": (att_now is not None and att_now < min_attendance)
                                 or (this_period.get("pct") is not None and this_period["pct"] < min_attendance),
            "requirement": min_attendance,
        },
        "gpa": {"current": gpa_now, "change": _delta(gpa_now, (base or {}).get("gpa"), 2)},
        "new_marks": marks,
        "grade_updates": grade_news,
        "deadlines": {
            "available": deadlines.get("available", False),
            "reason": deadlines.get("reason"),
            "upcoming": deadlines.get("upcoming") or [],
            "missed": [d for d in deadlines.get("overdue") or [] if start <= _parse(d["due_at"]) <= now],
        },
        "goals": {"items": goal_rows, "counts": goal_counts, "events": goal_news},
    }
    if days == MONTH:
        milestones = [f"{m['name']} graded in {m['course']}: {m['score']:g}" for m in marks]
        milestones += [g["detail"] for g in goal_news if g["title"] in ("Course goal achieved",)]
        summary["milestones"] = milestones
    summary["headline"] = headline(summary)
    return summary


def headline(s: dict) -> str:
    """One sentence for the top of the summary and the email subject line."""
    att = s["attendance"]["this_period"]
    parts = []
    if att.get("status") == "ok":
        parts.append(f"{att['pct']:g}% of classes attended")
    elif att.get("status") == "no_classes":
        parts.append("no classes recorded")
    n = len(s["new_marks"]) or len(s["grade_updates"])
    parts.append(f"{n} new mark{'s' if n != 1 else ''}" if n else "no new marks")
    upcoming = len(s["deadlines"]["upcoming"])
    if upcoming:
        parts.append(f"{upcoming} deadline{'s' if upcoming != 1 else ''} in the next 7 days")
    return ("This month: " if s["period"] == "month" else "This week: ") + ", ".join(parts) + "."


def as_text(s: dict, name: str) -> str:
    """Plain-text version for the email digest."""
    lines = [f"StudyMate {'monthly' if s['period'] == 'month' else 'weekly'} summary for {name}", "", s["headline"], ""]
    a = s["attendance"]
    if a["current"] is not None:
        change = f" ({a['change']:+g} pts)" if a["change"] is not None else ""
        lines.append(f"Attendance: {a['current']:g}%{change}")
    if s["gpa"]["current"] is not None:
        change = f" ({s['gpa']['change']:+.2f})" if s["gpa"]["change"] is not None else ""
        lines.append(f"Cumulative GPA: {s['gpa']['current']:.2f}{change}")
    if s["new_marks"]:
        lines += ["", "New marks:"] + [f"- {m['course']}: {m['name']} {m['score']:g}" for m in s["new_marks"]]
    elif s["grade_updates"]:
        lines += ["", "Grade updates:"] + [f"- {g['detail']}" for g in s["grade_updates"]]
    if s["deadlines"]["upcoming"]:
        lines += ["", "Coming up (7 days):"] + [f"- {d['title']} ({d.get('course') or 'course'}), due {d['due_at'][:10]}"
                                                 for d in s["deadlines"]["upcoming"]]
    if s["goals"]["items"]:
        lines += ["", "Goals:"] + [f"- {g['goal']}: {(g['status'] or 'not checked').replace('_', ' ')}" for g in s["goals"]["items"]]
    if a["below_requirement"]:
        lines += ["", f"Warning: attendance is below the {a['requirement']:g}% SDU requirement."]
    return "\n".join(lines)
