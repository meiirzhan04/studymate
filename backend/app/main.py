from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .repository import SQLiteRepository


Role = Literal["student", "teacher"]


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=200)


class User(BaseModel):
    id: str
    name: str
    role: Role
    student_id: Optional[str] = None
    teacher_id: Optional[str] = None


repo = SQLiteRepository()
SECRET = os.getenv("AUTH_SECRET", "development-only-secret")


def weighted_score(record: dict) -> Optional[float]:
    components = record.get("components", [])
    if not components or any(c.get("score") is None or c.get("weight") is None for c in components):
        return None
    weight = sum(c["weight"] for c in components)
    if not math.isclose(weight, 1.0, abs_tol=0.001):
        return None
    return round(sum(c["score"] * c["weight"] for c in components), 1)


def grade_point(score: float) -> float:
    if score >= 90: return 4.0
    if score >= 80: return 3.0
    if score >= 70: return 2.0
    if score >= 60: return 1.0
    return 0.0


def sign(payload: str) -> str:
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue_token(user: dict) -> str:
    raw = json.dumps({"sub": user["id"], "role": user["role"], "student_id": user.get("student_id"), "teacher_id": user.get("teacher_id"), "name": user["name"], "exp": int(time.time()) + 1800}, separators=(",", ":"))
    body = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    return f"{body}.{sign(body)}"


def current_user(authorization: Annotated[Optional[str], Header()] = None) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization[7:]
    try:
        body, signature = token.rsplit(".", 1)
        if not hmac.compare_digest(signature, sign(body)):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if payload["exp"] < time.time():
            raise ValueError
        return User(id=payload["sub"], name=payload["name"], role=payload["role"], student_id=payload.get("student_id"), teacher_id=payload.get("teacher_id"))
    except (ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_role(role: Role):
    def dependency(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role != role:
            raise HTTPException(status_code=403, detail=f"{role.title()} access required")
        return user
    return dependency


def student_courses(student_id: str, semester: str) -> list[dict]:
    result = []
    for row in repo.grades:
        if row["student_id"] == student_id and row["semester"] == semester:
            score = weighted_score(row)
            result.append({**row, "score": score, "data_status": "available" if score is not None else "insufficient_data"})
    return result


def risks(student_id: str) -> list[dict]:
    factors = []
    current = student_courses(student_id, "spring-2026")
    low = [c for c in current if c["score"] is not None and c["score"] < 60]
    if low: factors.append({"type": "low_grade", "detail": f"{len(low)} course below the configured demo threshold", "courses": [c["course"] for c in low]})
    attendance = repo.attendance.get(student_id)
    if attendance is not None and attendance < 75: factors.append({"type": "low_attendance", "detail": f"Attendance is {attendance}%"})
    missed = repo.missing_assignments.get(student_id, 0)
    if missed >= 2: factors.append({"type": "missed_assignments", "detail": f"{missed} assignments are overdue"})
    return factors


app = FastAPI(title="Student Performance API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health(): return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.post("/api/auth/login")
def login(request: LoginRequest):
    user = repo.authenticate(request.identifier, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid identifier or password")
    return {"access_token": issue_token(user), "token_type": "bearer", "expires_in": 1800, "user": user}


@app.get("/api/me")
def me(user: Annotated[User, Depends(current_user)]): return user


@app.get("/api/semesters")
def semesters(user: Annotated[User, Depends(current_user)]): return {"items": repo.semesters}


@app.get("/api/student/dashboard")
def student_dashboard(user: Annotated[User, Depends(require_role("student"))], semester: str = Query("spring-2026")):
    courses = student_courses(user.student_id, semester)
    valid = [c for c in courses if c["score"] is not None]
    credits = sum(c["credits"] for c in valid)
    gpa = round(sum(grade_point(c["score"]) * c["credits"] for c in valid) / credits, 2) if credits else None
    alerts = risks(user.student_id)
    weak = sorted(valid, key=lambda c: c["score"])[:2]
    recommendations = [{"course": c["course"], "reason": f"Current weighted score is {c['score']}%", "action": f"Review the lowest-scoring assessment components in {c['course']}"} for c in weak if c["score"] < 75]
    return {"semester": semester, "gpa": {"value": gpa, "data_status": "available" if gpa is not None else "insufficient_data", "scale": "demo_4_point_unconfirmed"}, "attendance": {"value": repo.attendance.get(user.student_id), "data_status": "available"}, "credits": credits, "courses": courses, "alerts": alerts, "recommendations": recommendations, "updated_at": datetime.now(timezone.utc).isoformat()}


@app.get("/api/student/grades")
def student_grades(user: Annotated[User, Depends(require_role("student"))], semester: str = Query("spring-2026")):
    return {"semester": semester, "items": student_courses(user.student_id, semester)}


@app.get("/api/teacher/students")
def teacher_students(user: Annotated[User, Depends(require_role("teacher"))]):
    ids = repo.teacher_scope.get(user.teacher_id, set())
    items = [{**repo.students[sid], "attendance": repo.attendance.get(sid), "risk_factors": risks(sid)} for sid in sorted(ids)]
    return {"items": items}


@app.get("/api/teacher/students/{student_id}")
def teacher_student(student_id: str, user: Annotated[User, Depends(require_role("teacher"))]):
    if student_id not in repo.teacher_scope.get(user.teacher_id, set()):
        raise HTTPException(status_code=404, detail="Student not found in teacher scope")
    return {"student": repo.students[student_id], "attendance": repo.attendance.get(student_id), "courses": student_courses(student_id, "spring-2026"), "risk_factors": risks(student_id)}


@app.get("/api/teacher/analytics/attendance-performance")
def attendance_performance(user: Annotated[User, Depends(require_role("teacher"))]):
    points = []
    for sid in repo.teacher_scope.get(user.teacher_id, set()):
        grades = [c["score"] for c in student_courses(sid, "spring-2026") if c["score"] is not None]
        if grades and sid in repo.attendance:
            points.append({"student_id": sid, "attendance": repo.attendance[sid], "average_grade": round(sum(grades) / len(grades), 1)})
    if len(points) < 3:
        return {"data_status": "insufficient_data", "points": points, "correlation": None, "note": "At least three paired observations are required."}
    xs, ys = [p["attendance"] for p in points], [p["average_grade"] for p in points]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    numerator = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denominator = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    correlation = round(numerator / denominator, 3) if denominator else None
    return {"data_status": "available" if correlation is not None else "insufficient_data", "points": points, "correlation": correlation, "note": "Correlation describes association and does not prove causation."}


# In production the frontend build is copied here by the container build.
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        requested = frontend_dist / path
        if path and requested.is_file() and frontend_dist in requested.resolve().parents:
            return FileResponse(requested)
        return FileResponse(frontend_dist / "index.html")
