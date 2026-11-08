"""US-18 / US-19: goal feasibility and progress tracking.

Pure functions only: main.py loads the academic records and passes them in, so every rule
here is testable without a database. Nothing is estimated from thin air: when a fact the
calculation needs is missing (class-hour counts, assessment weights, credits, the transcript)
the result says so with status "insufficient_data" instead of guessing.

Conventions
- Percent values are 0-100. Assessment weights are fractions that add up to 1.
- A score of None means "not graded yet"; it is never read as 0.
- Maximums are rounded DOWN and required scores UP for display, so rounding can never make an
  impossible target look possible. Feasibility itself is decided on the exact numbers.
"""
from __future__ import annotations

import math
from typing import Callable, Optional

from .academics import grade_point, letter_for, required_score

EPS = 1e-9

AHEAD = "ahead"
ON_TRACK = "on_track"
BEHIND = "behind"
ACHIEVED = "achieved"
UNACHIEVABLE = "unachievable"
INSUFFICIENT = "insufficient_data"
STATUS_LABELS = {
    AHEAD: "Ahead of target", ON_TRACK: "On track", BEHIND: "Behind pace", ACHIEVED: "Goal achieved",
    UNACHIEVABLE: "Unachievable", INSUFFICIENT: "Insufficient data",
}

GRADE_AHEAD_MARGIN = 5.0      # current form this many points above the required average = ahead
ATTENDANCE_AHEAD_MARGIN = 2.0
GPA_AHEAD_MARGIN = 0.10
HIGH_REQUIRED_SCORE = 90.0    # needing this much or more on the remaining work triggers an alert
WEIGHT_TOLERANCE = 0.005


def floor_to(value: float, decimals: int = 1) -> float:
    step = 10 ** decimals
    return math.floor(value * step + EPS) / step


def ceil_to(value: float, decimals: int = 1) -> float:
    step = 10 ** decimals
    return math.ceil(value * step - EPS) / step


def _num(value) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _fmt(value: float, decimals: int = 1) -> str:
    text = f"{value:.{decimals}f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


# ─── Course grade ────────────────────────────────────────────────────
def normalize_components(components) -> tuple[Optional[list[dict]], Optional[str]]:
    """Validated assessment breakdown, or (None, why it cannot be used)."""
    if not components:
        return None, "No assessment breakdown is available for this course."
    parts = []
    for c in components:
        weight, score = _num(c.get("weight")), c.get("score")
        if weight is None or weight <= 0:
            return None, "An assessment has no weight."
        if score is not None:
            score = _num(score)
            if score is None or score < 0 or score > 100:
                return None, "An assessment score is outside 0-100."
        parts.append({"name": str(c.get("name") or "Assessment"), "weight": weight, "score": score,
                      "group": c.get("group")})
    if not math.isclose(sum(p["weight"] for p in parts), 1.0, abs_tol=WEIGHT_TOLERANCE):
        return None, "The assessment weights do not add up to 100%."
    return parts, None


def course_total(parts: list[dict], fill: Callable[[int], float], policy: Optional[dict] = None) -> float:
    """Final course percent when every ungraded assessment i scores fill(i).

    policy (optional, only when the course configures it):
      drop_lowest: {group: n}  the n lowest results in that group do not count; the group's weight
                               is shared by the items that are kept
      curve: points            added to the final percent, capped at 100
    """
    policy = policy or {}
    drops = policy.get("drop_lowest") or {}
    total = 0.0
    grouped: dict[str, list[tuple[float, float]]] = {}
    for i, p in enumerate(parts):
        value = p["score"] if p["score"] is not None else fill(i)
        group = p.get("group")
        if group and drops.get(group):
            grouped.setdefault(group, []).append((value, p["weight"]))
        else:
            total += value * p["weight"]
    for group, items in grouped.items():
        keep = max(1, len(items) - int(drops[group]))
        best = sorted((v for v, _w in items), reverse=True)[:keep]
        total += sum(best) / keep * sum(w for _v, w in items)
    curve = _num(policy.get("curve")) or 0.0
    return min(100.0, total + curve)


def _smallest_reaching(f: Callable[[float], float], target: float) -> Optional[float]:
    """Smallest x in [0, 100] with f(x) >= target for a non-decreasing f; None if 100 is not enough."""
    if f(0.0) >= target - EPS:
        return 0.0
    if f(100.0) < target - EPS:
        return None
    lo, hi = 0.0, 100.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(mid) >= target - EPS:
            hi = mid
        else:
            lo = mid
    return hi


def evaluate_course(components, target: Optional[float], policy: Optional[dict] = None) -> dict:
    """Maximum achievable grade, required scores and goal status for one course."""
    parts, problem = normalize_components(components)
    if parts is None:
        return {"status": INSUFFICIENT if target is not None else None, "verdict": "unverified" if target is not None else None,
                "known": False, "missing": ["assessment weights and grades"], "reason": problem,
                "message": "Unable to verify goal feasibility: " + problem[0].lower() + problem[1:] if target is not None else problem}

    graded = [p for p in parts if p["score"] is not None]
    remaining = [i for i, p in enumerate(parts) if p["score"] is None]
    earned = sum(p["score"] * p["weight"] for p in graded)
    completion = sum(p["weight"] for p in graded)
    maximum = course_total(parts, lambda _i: 100.0, policy)
    minimum = course_total(parts, lambda _i: 0.0, policy)
    form = earned / completion if completion > EPS else None
    out = {
        "known": True, "final": not remaining, "maximum": floor_to(maximum), "minimum": floor_to(minimum),
        "earned": round(earned, 1), "completion": round(completion * 100), "completion_exact": completion, "current_form": round(form, 1) if form is not None else None,
        "remaining": [{"name": parts[i]["name"], "weight": round(parts[i]["weight"] * 100, 1)} for i in remaining],
        "max_exact": maximum, "min_exact": minimum,
    }
    if target is None:
        out.update(status=None, verdict=None)
        return out

    out["target"] = target
    if maximum < target - EPS:
        out.update(status=UNACHIEVABLE, verdict="impossible", suggested=floor_to(maximum),
                   message=(f"Your target of {_fmt(target)}% is not achievable. Based on your completed assessments and "
                            f"remaining grading opportunities, your maximum achievable grade is {_fmt(floor_to(maximum))}%.")
                   if remaining else f"Your final grade is {_fmt(floor_to(maximum))}%, below the {_fmt(target)}% target.")
        return out
    if minimum >= target - EPS:
        out.update(status=ACHIEVED, verdict="achieved",
                   message=(f"Goal achieved: your final grade is {_fmt(floor_to(maximum))}%." if not remaining else
                            f"Goal secured: even with 0 on the remaining work you finish at {_fmt(floor_to(minimum))}% or more."))
        return out

    # Feasible and not yet secured: what the remaining work needs
    def uniform(x: float) -> float:
        return course_total(parts, lambda _i: x, policy)

    need = ceil_to(_smallest_reaching(uniform, target))
    per_item = []
    for i in remaining:
        x = _smallest_reaching(lambda v, i=i: course_total(parts, lambda j: v if j == i else 100.0, policy), target)
        per_item.append({"name": parts[i]["name"], "weight": round(parts[i]["weight"] * 100, 1), "min_score": ceil_to(x)})
    out["remaining"] = per_item
    out["required_average"] = need
    if len(remaining) == 1:
        out["message"] = f"You need at least {_fmt(need)}/100 on your {parts[remaining[0]]['name']} to reach {_fmt(target)}%."
    else:
        out["message"] = (f"If you score the same on every remaining assessment, you need at least {_fmt(need)}% on each "
                          f"to reach {_fmt(target)}%.")

    if form is None:
        status, pace = ON_TRACK, "Nothing is graded yet, so pace is measured once the first result arrives."
    elif form >= need + GRADE_AHEAD_MARGIN:
        status, pace = AHEAD, f"Your graded work averages {_fmt(form)}%, above the {_fmt(need)}% you need from here."
    elif form >= need - EPS:
        status, pace = ON_TRACK, f"Your graded work averages {_fmt(form)}%, in line with the {_fmt(need)}% you need from here."
    else:
        status, pace = BEHIND, f"Your graded work averages {_fmt(form)}%, below the {_fmt(need)}% you need from here."
    out.update(status=status, verdict="achievable", pace=pace)
    return out


# ─── Attendance ──────────────────────────────────────────────────────
def attendance_counts(row: dict) -> tuple[Optional[dict], list[str]]:
    """Class-hour counts from an SDU journal row, or what is missing."""
    hours = _num(row.get("hours"))
    present, absent, permitted = _num(row.get("present")), _num(row.get("absent")), _num(row.get("permitted"))
    missing = []
    if hours is None or hours <= 0:
        missing.append("total scheduled class hours")
    if present is None or absent is None:
        missing.append("attended and missed class hours")
    if missing:
        return None, missing
    permitted = permitted or 0.0
    if min(present, absent, permitted) < 0 or present + absent + permitted > hours + EPS:
        return None, ["consistent class-hour counts"]
    return {"hours": hours, "present": present, "absent": absent, "permitted": permitted,
            "conducted": present + absent + permitted, "remaining": hours - present - absent - permitted}, []


def percent_upper_bound(absence_percent: Optional[float]) -> Optional[float]:
    """Highest attendance an SDU absence percentage still allows, without class-hour counts.

    Absence is counted against every scheduled hour and never decreases, so attendance can only
    fall. The reported percentage may be rounded (the portal prints whole numbers), so the bound
    adds the rounding margin: it can prove a target impossible, never that one is achievable.
    """
    if absence_percent is None or absence_percent < 0:
        return None
    margin = 0.5 if float(absence_percent).is_integer() else 0.05
    return min(100.0, 100.0 - absence_percent + margin)


def evaluate_attendance_course(row: dict, target: Optional[float], absence_limit: float = 30.0) -> dict:
    """SDU rule: absence % = missed hours / all scheduled hours; excused ("permitted") hours are not absences.

    So attendance can only fall: attending every remaining hour keeps it where it is, which makes the
    current value the maximum achievable one ((attended + excused + remaining) / scheduled).
    """
    counts, missing = attendance_counts(row)
    base = {"course": row.get("course") or row.get("lesson"), "code": row.get("code") or row.get("course_code")}
    if counts is None:
        pct = _num(row.get("absence_percent"))
        out = {**base, "known": False, "missing": missing, "status": INSUFFICIENT if target is not None else None,
               "reported": round(100 - pct, 1) if pct is not None else None,
               "message": "Unable to verify goal feasibility: missing " + " and ".join(missing) + "."}
        upper = percent_upper_bound(pct)
        if upper is not None:
            out.update(bound_only=True, max_exact=upper, maximum=floor_to(upper))
            if target is not None and upper < target - EPS:
                out.update(status=UNACHIEVABLE, verdict="impossible", suggested=floor_to(100.0 - pct),
                           message=(f"Your target of {_fmt(target)}% is not achievable. Absences never go away, so with "
                                    f"{_fmt(pct)}% already missed your attendance cannot rise above {_fmt(floor_to(upper))}%."))
        return out

    h, absent, remaining = counts["hours"], counts["absent"], counts["remaining"]
    current = 100.0 - absent / h * 100.0
    conducted = counts["conducted"]
    so_far = (counts["present"] + counts["permitted"]) / conducted * 100.0 if conducted else None
    rate = absent / conducted if conducted else 0.0
    projected = 100.0 - (absent + rate * remaining) / h * 100.0
    limit_hours = math.ceil(h * absence_limit / 100.0 - EPS) - 1      # most absent hours that stay under the limit
    out = {
        **base, "known": True, **{k: (int(v) if float(v).is_integer() else v) for k, v in counts.items()},
        "current": floor_to(current), "maximum": floor_to(current), "max_exact": current, "so_far": round(so_far, 1) if so_far is not None else None,
        "projected": floor_to(projected), "limit_buffer": int(max(-1, limit_hours - absent)),
    }
    if target is None:
        out.update(status=None)
        return out

    allowed = math.floor(h * (100.0 - target) / 100.0 + EPS)            # most absent hours that keep >= target
    affordable = int(allowed - absent)
    out["target"] = target
    if current < target - EPS:
        out.update(status=UNACHIEVABLE, verdict="impossible", suggested=floor_to(current), affordable=affordable,
                   message=(f"Your target of {_fmt(target)}% is not achievable. Even if you attend every remaining class, "
                            f"your maximum possible attendance is {_fmt(floor_to(current))}%." if remaining else
                            f"All classes are over: final attendance is {_fmt(floor_to(current))}%, below {_fmt(target)}%."))
        return out
    if not remaining:
        out.update(status=ACHIEVED, verdict="achieved", affordable=0, must_attend=0,
                   message=f"Goal achieved: final attendance is {_fmt(floor_to(current))}%.")
        return out

    can_miss = int(min(affordable, remaining))
    must_attend = int(remaining - can_miss)
    if can_miss == 0:
        message = f"To reach your {_fmt(target)}% attendance goal, you must attend all {_fmt(remaining, 0)} remaining class hours."
    else:
        message = (f"Attend at least {must_attend} of the {_fmt(remaining, 0)} remaining class hours; "
                   f"you can miss up to {can_miss} more and still reach {_fmt(target)}%.")
    if projected >= target + ATTENDANCE_AHEAD_MARGIN:
        status = AHEAD
    elif projected >= target - EPS:
        status = ON_TRACK
    else:
        status = BEHIND
    out.update(status=status, verdict="achievable", affordable=can_miss, must_attend=must_attend, message=message)
    return out


def n_or_1(items: list) -> int:
    return len(items) or 1


def evaluate_attendance_overall(rows: list[dict], target: Optional[float]) -> dict:
    """Overall attendance the way StudyMate computes the official figure: 100 - mean course absence %."""
    if not rows:
        return {"known": False, "status": INSUFFICIENT if target is not None else None,
                "missing": ["SDU attendance records"],
                "message": "Unable to verify goal feasibility: no SDU attendance records are synced yet."}
    courses = [evaluate_attendance_course(r, target) for r in rows]
    unknown = [c for c in courses if not c["known"]]
    if unknown:
        names = ", ".join(str(c["course"]) for c in unknown[:3]) + (" …" if len(unknown) > 3 else "")
        out = {"known": False, "status": INSUFFICIENT if target is not None else None, "courses": courses,
               "missing": ["class-hour counts for " + names],
               "message": f"Unable to verify goal feasibility: class-hour counts are missing for {names}."}
        if all(c.get("max_exact") is not None for c in courses):
            # Same mean as the official figure, using each course's exact maximum or its percentage bound
            upper = sum(c["max_exact"] for c in courses) / n_or_1(courses)
            out.update(bound_only=True, max_exact=upper, maximum=floor_to(upper))
            if target is not None and upper < target - EPS:
                out.update(status=UNACHIEVABLE, verdict="impossible", suggested=floor_to(upper),
                           message=(f"Your target of {_fmt(target)}% is not achievable. Absences already recorded by SDU "
                                    f"keep your attendance at or below {_fmt(floor_to(upper))}%, even if you attend every remaining class."))
        return out

    n = len(courses)
    maximum = sum(c["max_exact"] for c in courses) / n
    projected = sum(100.0 - (c["absent"] + (c["absent"] / c["conducted"] if c["conducted"] else 0) * c["remaining"]) / c["hours"] * 100
                    for c in courses) / n
    remaining = sum(c["remaining"] for c in courses)
    out = {"known": True, "courses": courses, "current": floor_to(maximum), "maximum": floor_to(maximum),
           "max_exact": maximum, "projected": floor_to(projected), "remaining": int(remaining) if float(remaining).is_integer() else remaining}
    if target is None:
        out.update(status=None)
        return out
    out["target"] = target
    if maximum < target - EPS:
        out.update(status=UNACHIEVABLE, verdict="impossible", suggested=floor_to(maximum),
                   message=(f"Your target of {_fmt(target)}% is not achievable. Even if you attend every remaining class, "
                            f"your maximum possible attendance is {_fmt(floor_to(maximum))}%. Please select a realistic target."))
    elif not remaining:
        out.update(status=ACHIEVED, verdict="achieved", message=f"Goal achieved: final attendance is {_fmt(floor_to(maximum))}%.")
    else:
        status = AHEAD if projected >= target + ATTENDANCE_AHEAD_MARGIN else ON_TRACK if projected >= target - EPS else BEHIND
        tight = [c for c in courses if c.get("status") in (BEHIND, UNACHIEVABLE) or c.get("affordable") == 0 and c["remaining"]]
        out.update(status=status, verdict="achievable",
                   message=(f"Achievable: attending every remaining class keeps you at {_fmt(floor_to(maximum))}%. "
                            f"At your current pace you would finish near {_fmt(floor_to(projected))}%."),
                   tight_courses=[c["course"] for c in tight])
    return out


# ─── GPA ─────────────────────────────────────────────────────────────
def _course_gp_bounds(course: dict) -> dict:
    ev = course.get("evaluation") or {}
    credits = _num(course.get("credits")) or 0.0
    if ev.get("known"):
        return {"credits": credits, "known": True, "final": ev.get("final"),
                "max_gp": grade_point(ev["max_exact"]), "min_gp": grade_point(ev["min_exact"]),
                "projected_pct": (ev["earned"] + ev["current_form"] * (1 - ev["completion_exact"]))
                if ev.get("current_form") is not None else None}
    return {"credits": credits, "known": False, "final": False, "max_gp": None, "min_gp": 0.0, "projected_pct": None}


def evaluate_gpa(target: Optional[float], basis: str, courses: list[dict],
                 past: Optional[dict] = None, current_cumulative: Optional[float] = None,
                 course_targets: Optional[dict] = None) -> dict:
    """Highest and lowest reachable semester or cumulative GPA, from this term's course evaluations.

    courses: this term's courses as {"course", "code", "credits", "evaluation": evaluate_course(...)}
    past:    {"points", "credits"} of graded transcript courses outside this term (cumulative only)
    A course without a breakdown can reach at most 4.0 and at least 0.0, so with such courses the
    result is a range: a target above its top is impossible, one below its floor is safe, and one
    in between cannot be verified yet.
    """
    basis = basis if basis in ("semester", "cumulative") else "semester"
    out: dict = {"basis": basis, "target": target}
    missing = []
    rows = [{**c, **_course_gp_bounds(c)} for c in courses]
    no_credits = [r["course"] for r in rows if r["credits"] <= 0]
    if not rows:
        missing.append("this term's courses")
    if no_credits:
        missing.append("credits for " + ", ".join(no_credits[:3]))
    if basis == "cumulative" and (not past or (past.get("credits") or 0) <= 0):
        missing.append("your transcript with completed credits")
    if missing:
        out.update(known=False, status=INSUFFICIENT if target is not None else None, missing=missing,
                   current=current_cumulative if basis == "cumulative" else None,
                   message="Unable to verify goal feasibility: missing " + "; ".join(missing) + ".")
        return out

    base_points = past["points"] if basis == "cumulative" else 0.0
    base_credits = past["credits"] if basis == "cumulative" else 0.0
    term_credits = sum(r["credits"] for r in rows)
    total_credits = base_credits + term_credits

    def gpa(gp_of) -> float:
        return (base_points + sum(gp_of(r) * r["credits"] for r in rows)) / total_credits

    upper = gpa(lambda r: r["max_gp"] if r["known"] else 4.0)
    lower_max = gpa(lambda r: r["max_gp"] if r["known"] else 0.0)
    minimum = gpa(lambda r: r["min_gp"])
    unknown = [r["course"] for r in rows if not r["known"]]
    finals = [r for r in rows if r["known"] and r["final"]]
    if basis == "cumulative":
        current = current_cumulative
    else:
        done = sum(r["credits"] for r in finals)
        current = round(sum(r["max_gp"] * r["credits"] for r in finals) / done, 2) if done else None
    out.update(known=True, current=current, maximum=floor_to(upper, 2), max_exact=upper, minimum=floor_to(minimum, 2),
               bound_only=bool(unknown), unknown_courses=unknown, credits=round(total_credits, 1))

    # Uniform course requirement: the lowest letter that, in every course still open, reaches the target
    open_rows = [r for r in rows if not (r["known"] and r["final"])]
    if target is not None and open_rows:
        fixed = base_points + sum(r["max_gp"] * r["credits"] for r in finals)
        needed_gp = (target * total_credits - fixed) / sum(r["credits"] for r in open_rows)
        out["required_gp"] = round(needed_gp, 2)
        if needed_gp <= EPS:
            out["required_score"] = 0.0
        else:
            score = required_score(needed_gp)
            out["required_score"] = score
            out["required_letter"] = letter_for(score) if score is not None else None
        # What the student's own course targets add up to, when every open course has one
        targets = course_targets or {}
        if all(targets.get(r.get("code")) is not None for r in open_rows):
            points = fixed + sum(grade_point(targets[r["code"]]) * r["credits"] for r in open_rows)
            out["targets_gpa"] = floor_to(points / total_credits, 2)
            out["targets_enough"] = points / total_credits >= target - EPS
    if target is None:
        out["status"] = None
        return out

    label = "cumulative GPA" if basis == "cumulative" else "semester GPA"
    if upper < target - EPS:
        out.update(status=UNACHIEVABLE, verdict="impossible", suggested=floor_to(upper, 2),
                   message=(f"A {label} of {target:.2f} is not achievable. Even with full marks on every remaining "
                            f"assessment, the highest {label} you can reach is {floor_to(upper, 2):.2f}."))
        return out
    if minimum >= target - EPS:
        out.update(status=ACHIEVED, verdict="achieved",
                   message=f"Goal achieved: your {label} cannot fall below {floor_to(minimum, 2):.2f}.")
        return out
    if lower_max < target - EPS:
        names = ", ".join(unknown[:3]) + (" …" if len(unknown) > 3 else "")
        out.update(status=INSUFFICIENT, verdict="unverified",
                   message=(f"Unable to verify goal feasibility: the assessment breakdown is missing for {names}. "
                            f"The target is within the theoretical maximum of {floor_to(upper, 2):.2f}."))
        return out

    projections = [r["max_gp"] if r["final"] else (grade_point(r["projected_pct"]) if r["projected_pct"] is not None else None)
                   for r in rows]
    if any(p is None for p in projections):
        status, pace = ON_TRACK, "Achievable; pace is measured once every course has graded work."
    else:
        projected = (base_points + sum(p * r["credits"] for p, r in zip(projections, rows))) / total_credits
        out["projected"] = round(projected, 2)
        status = AHEAD if projected >= target + GPA_AHEAD_MARGIN else ON_TRACK if projected >= target - EPS else BEHIND
        pace = f"At your current form you would finish near {projected:.2f}."
    message = f"Achievable: the highest {label} you can still reach is {floor_to(upper, 2):.2f}."
    if out.get("required_gp") and out["required_gp"] > 0:
        message += f" Your open courses need an average grade point of {out['required_gp']:.2f} or more."
    out.update(status=status, verdict="achievable", pace=pace, message=message)
    return out


# ─── Alerts and recommendations ──────────────────────────────────────
def alerts(tracking: dict) -> list[dict]:
    """Alerts for the current state; `key` is stable so the same alert is never sent twice."""
    items = []
    gpa = tracking.get("gpa") or {}
    att = tracking.get("attendance") or {}
    target = gpa.get("target")
    if target is not None and gpa.get("status") == UNACHIEVABLE:
        items.append({"key": f"gpa:{gpa['basis']}:{target}:unachievable", "tone": "danger", "course": None,
                      "title": "GPA goal no longer achievable",
                      "detail": f"Your {target:.2f} {gpa['basis']} GPA goal is no longer mathematically achievable based on your current grades "
                                f"(maximum {gpa['maximum']:.2f})."})
    if att.get("target") is not None:
        if att.get("status") == UNACHIEVABLE:
            items.append({"key": f"attendance:{att['target']}:unachievable", "tone": "danger", "course": None,
                          "title": "Attendance goal no longer achievable",
                          "detail": f"Your attendance target is no longer achievable. The maximum possible attendance is {_fmt(att['maximum'])}%."})
        for c in att.get("courses") or []:
            if c.get("status") == BEHIND or (c.get("status") in (AHEAD, ON_TRACK) and c.get("affordable") == 0):
                items.append({"key": f"attendance:{c['code'] or c['course']}:{att['target']}:pace", "tone": "warning", "course": c["course"],
                              "title": "Attendance below the required pace",
                              "detail": f"Your attendance in {c['course']} is below the required pace. Attend all remaining classes to reach your goal."
                              if c.get("affordable") == 0 else
                              f"Your attendance in {c['course']} is below the required pace. {c['message']}"})
    for c in tracking.get("courses") or []:
        ev, tgt = c.get("evaluation") or {}, c.get("target")
        if tgt is None or not ev.get("status"):
            continue
        key = f"course:{c['code']}:{tgt}"
        if ev["status"] == UNACHIEVABLE:
            items.append({"key": key + ":unachievable", "tone": "danger", "course": c["course"], "title": "Course goal no longer achievable",
                          "detail": f"{c['course']}: {ev['message']}"})
        elif ev["status"] == ACHIEVED:
            items.append({"key": key + ":achieved", "tone": "success", "course": c["course"], "title": "Course goal achieved",
                          "detail": f"{c['course']}: {ev['message']}"})
        else:
            need = ev.get("required_average")
            if ev["status"] == BEHIND:
                items.append({"key": key + ":behind", "tone": "warning", "course": c["course"], "title": "Grade below the required trajectory",
                              "detail": f"{c['course']}: {ev.get('pace')}"})
            # Only when earlier results raised the bar: needing 90% for a 90% goal with nothing graded is no news
            if need is not None and need >= HIGH_REQUIRED_SCORE and need > tgt + EPS and ev.get("completion"):
                single = ev["remaining"][0]["name"] if len(ev["remaining"]) == 1 else "the remaining assessments"
                items.append({"key": key + f":high:{need}", "tone": "warning", "course": c["course"], "title": "High score needed",
                              "detail": f"You need at least {_fmt(need)}% on {'your ' + single if len(ev['remaining']) == 1 else single} "
                                        f"to reach {_fmt(tgt)}% ({letter_for(tgt)}) in {c['course']}."})
    return items


def recommendations(tracking: dict) -> list[str]:
    """Concrete next steps backed by the numbers above; nothing generic."""
    tips: list[str] = []
    att = tracking.get("attendance") or {}
    for c in att.get("courses") or []:
        if c.get("target") is None or not c.get("known"):
            continue
        if c.get("status") == UNACHIEVABLE:
            continue
        if c.get("affordable") == 0 and c.get("remaining"):
            tips.append(f"Attend every remaining class in {c['course']}: you cannot miss another hour and keep {_fmt(c['target'])}%.")
        elif c.get("status") == BEHIND:
            tips.append(f"{c['course']}: you can miss at most {c['affordable']} more class hours; at your current rate you would miss more.")
        if c.get("limit_buffer") is not None and 0 <= c["limit_buffer"] <= 2 and c.get("remaining"):
            tips.append(f"{c['course']}: {c['limit_buffer']} more absent hours reach SDU's absence limit.")
    if att.get("status") == UNACHIEVABLE:
        tips.append(f"Lower your attendance target to {_fmt(att['suggested'])}% or less; higher is no longer reachable.")

    open_courses = []
    for c in tracking.get("courses") or []:
        ev, tgt = c.get("evaluation") or {}, c.get("target")
        if tgt is None or not ev.get("known"):
            continue
        if ev.get("status") == UNACHIEVABLE:
            tips.append(f"Review your {c['course']} goal: the maximum achievable grade is now {_fmt(ev['maximum'])}%.")
        elif ev.get("status") in (BEHIND, ON_TRACK, AHEAD) and ev.get("remaining"):
            heaviest = max(ev["remaining"], key=lambda r: r["weight"])
            open_courses.append((ev.get("status"), heaviest["weight"], c["course"], heaviest, ev))
    for status, _w, course, heaviest, ev in sorted(open_courses, key=lambda t: (t[0] != BEHIND, -t[1])):
        if status == BEHIND:
            tips.append(f"Prioritise {heaviest['name']} in {course} ({_fmt(heaviest['weight'])}% of the grade): "
                        f"you need {_fmt(ev['required_average'])}% on average from here.")
        elif status == ON_TRACK and ev.get("completion"):
            tips.append(f"Keep an average of {_fmt(ev['required_average'])}% on the remaining {course} work to stay on track.")

    gpa = tracking.get("gpa") or {}
    if gpa.get("status") == UNACHIEVABLE:
        tips.append(f"Set your GPA goal to {gpa['suggested']:.2f} or lower; that is the most you can still reach.")
    elif gpa.get("status") in (BEHIND, ON_TRACK, AHEAD, INSUFFICIENT) and gpa.get("target") is not None and gpa.get("required_gp", 0) > 0:
        goal, need = f"{gpa['target']:.2f}", f"{gpa['required_gp']:.2f}"
        if gpa.get("targets_gpa") is not None and gpa.get("targets_enough"):
            tips.append(f"Reaching your course targets gives a {gpa['basis']} GPA of {gpa['targets_gpa']:.2f}, enough for your {goal} goal.")
        elif gpa.get("targets_gpa") is not None:
            tips.append(f"Your course targets add up to a {gpa['basis']} GPA of {gpa['targets_gpa']:.2f}, below your {goal} goal: "
                        f"your open courses need an average grade point of {need} (A- = 3.67, A = 4.00).")
        else:
            tips.append(f"For a {goal} {gpa['basis']} GPA your open courses need an average grade point of {need} "
                        f"(A- = 3.67, A = 4.00); {_fmt(gpa['required_score'])}%+ ({gpa.get('required_letter')}) in every one is the safe way.")
    seen, unique = set(), []
    for t in tips:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    return unique[:8]
