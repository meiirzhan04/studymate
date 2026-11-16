"""Direct client for the SDU teacher/staff portal (pms.sdu.edu.kz / auth.sdu.edu.kz).

The password is used once against auth.sdu.edu.kz (client_id='pms') and never stored; the
connection keeps only the encrypted PMS tokens, just like sdu_portal.py keeps encrypted cookies.
"""
from __future__ import annotations

import os
from typing import Optional

import httpx

from . import sdu_portal

AUTH_ORIGIN = os.getenv("SDU_AUTH_ORIGIN", "https://auth.sdu.edu.kz").rstrip("/")
PMS_API_ORIGIN = os.getenv("SDU_PMS_API_ORIGIN", "https://pms-alpha-api.sdu.edu.kz").rstrip("/")
PMS_CLIENT_ID = os.getenv("SDU_PMS_CLIENT_ID", "pms")
TOKEN_PREFIX = "pms:"
SOURCE = "pms"
PENDING_TTL_SECONDS = 10 * 60
TIMEOUT = httpx.Timeout(20.0, connect=8.0)

# Tests swap in an httpx.MockTransport (same pattern as sdu_portal.TRANSPORT).
TRANSPORT: Optional[httpx.AsyncBaseTransport] = None


def pms_enabled() -> bool:
    return os.getenv("ENABLE_PMS_LOGIN", "1") != "0"


def is_pms_token(access_token: Optional[str]) -> bool:
    return bool(access_token) and access_token.startswith(TOKEN_PREFIX)


def connection_token(tokens: dict) -> str:
    return TOKEN_PREFIX + sdu_portal.seal(tokens)


def unseal_tokens(access_token: Optional[str]) -> Optional[dict]:
    if not is_pms_token(access_token):
        return None
    return sdu_portal.unseal(access_token[len(TOKEN_PREFIX):])


class PmsError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def normalize_username(username: str) -> str:
    clean = username.strip()
    if clean.lower().endswith("@sdu.edu.kz"):
        return clean.split("@", 1)[0].strip()
    return clean


def _auth_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=AUTH_ORIGIN,
        timeout=TIMEOUT,
        transport=TRANSPORT,
        headers={"Accept": "application/json", "User-Agent": "StudyMate/1.0"},
    )


def _api_client(tokens: dict) -> httpx.AsyncClient:
    token_type = tokens.get("token_type") or "Bearer"
    access_token = tokens.get("access_token") or ""
    return httpx.AsyncClient(
        base_url=f"{PMS_API_ORIGIN}/1.0.0",
        timeout=TIMEOUT,
        transport=TRANSPORT,
        headers={
            "Accept": "application/json",
            "Content-Language": "en-EN",
            "Authorization": f"{token_type} {access_token}".strip(),
            "User-Agent": "StudyMate/1.0",
        },
    )


def _error_message(resp: httpx.Response, fallback: str) -> str:
    try:
        body = resp.json()
        if isinstance(body, dict):
            msg = body.get("message") or body.get("detail") or body.get("error_description")
            if isinstance(msg, str) and msg.strip():
                return msg.strip()
    except ValueError:
        pass
    return fallback


def _extract_tokens(data: dict) -> dict:
    access_token = data.get("access_token")
    if not access_token:
        raise PmsError(502, "SDU PMS did not return a session token. Try again.")
    return {
        "access_token": access_token,
        "token_type": data.get("token_type") or "Bearer",
        "refresh_token": data.get("refresh_token"),
        "expires_at": data.get("expires_at"),
        "verified_status": data.get("verified_status"),
    }


def _two_factor_payload(challenge_token: str, username: str, data: dict) -> dict:
    masked = data.get("masked_email") or "your SDU email"
    cooldown = data.get("resend_cooldown_seconds") or 60
    pending = sdu_portal.seal({"challenge_token": challenge_token, "username": username})
    return {
        "state": "verify",
        "pending": pending,
        "notice": f"SDU sent a 6-digit code to {masked}. Check Spam if it isn't in your inbox.",
        "resend_cooldown": cooldown,
    }


async def login(username: str, password: str) -> dict:
    """Authenticate a teacher against auth.sdu.edu.kz with client_id='pms'."""
    clean_user = normalize_username(username)
    try:
        async with _auth_client() as client:
            resp = await client.post(
                "/login",
                json={
                    "client_id": PMS_CLIENT_ID,
                    "username": clean_user,
                    "password": password,
                    "device": "web:desktop",
                },
            )
    except httpx.HTTPError as exc:
        raise PmsError(502, f"SDU PMS auth service did not respond ({type(exc).__name__}). Try again in a minute.")

    if resp.status_code >= 500:
        raise PmsError(502, _error_message(resp, "SDU PMS auth service is unavailable right now."))
    if resp.status_code >= 400:
        raise PmsError(401, _error_message(resp, "Wrong PMS username or password."))

    try:
        data = resp.json()
    except ValueError as exc:
        raise PmsError(502, "SDU PMS auth returned an unexpected response.") from exc

    if data.get("two_factor_required") is True:
        challenge = data.get("challenge_token")
        if not challenge:
            raise PmsError(502, "SDU PMS requested verification without a challenge token.")
        return _two_factor_payload(challenge, clean_user, data)

    return {"state": "ok", "tokens": _extract_tokens(data), "username": clean_user}


async def verify(pending: str, code: str) -> dict:
    """Verify the 6-digit 2FA code for a pending PMS login."""
    info = sdu_portal.unseal(pending, ttl=PENDING_TTL_SECONDS)
    if not info or not info.get("challenge_token"):
        raise PmsError(400, "The verification step expired. Sign in again.")
    try:
        async with _auth_client() as client:
            resp = await client.post(
                "/two-factor/verify",
                json={"challenge_token": info["challenge_token"], "code": code},
            )
    except httpx.HTTPError as exc:
        raise PmsError(502, f"SDU PMS auth service did not respond ({type(exc).__name__}). Try again in a minute.")

    if resp.status_code >= 500:
        raise PmsError(502, _error_message(resp, "SDU PMS verification failed on server."))
    if resp.status_code >= 400:
        msg = _error_message(resp, "Wrong verification code. Check the latest email from SDU.")
        status = 400 if "expir" in msg.lower() else 401
        raise PmsError(status, msg)

    try:
        data = resp.json()
    except ValueError as exc:
        raise PmsError(502, "SDU PMS verification returned an unexpected response.") from exc

    return {"state": "ok", "tokens": _extract_tokens(data), "username": info.get("username", "")}


async def resend(pending: str) -> dict:
    """Resend the 6-digit 2FA email for a pending PMS login."""
    info = sdu_portal.unseal(pending, ttl=PENDING_TTL_SECONDS)
    if not info or not info.get("challenge_token"):
        raise PmsError(400, "The verification step expired. Sign in again.")
    try:
        async with _auth_client() as client:
            resp = await client.post(
                "/two-factor/resend",
                json={"challenge_token": info["challenge_token"]},
            )
    except httpx.HTTPError as exc:
        raise PmsError(502, f"SDU PMS auth service did not respond ({type(exc).__name__}). Try again in a minute.")

    if resp.status_code >= 500:
        raise PmsError(502, _error_message(resp, "Could not resend code right now."))
    if resp.status_code >= 400:
        raise PmsError(400, _error_message(resp, "The verification step expired. Sign in again."))

    try:
        data = resp.json()
    except ValueError:
        data = {}

    next_challenge = data.get("challenge_token") or info["challenge_token"]
    return _two_factor_payload(next_challenge, info.get("username", ""), data)


async def refresh_tokens(tokens: dict) -> Optional[dict]:
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        return None
    try:
        async with _auth_client() as client:
            resp = await client.post("/token/refresh", json={"refresh_token": refresh_token})
        if resp.status_code != 200:
            return None
        return _extract_tokens(resp.json())
    except (httpx.HTTPError, ValueError, PmsError):
        return None


def _unwrap(body) -> dict | list:
    if isinstance(body, dict) and "data" in body:
        return body["data"]
    return body


async def _api_get(tokens: dict, path: str, params: Optional[dict] = None) -> tuple[int, dict | list | None, dict]:
    current = dict(tokens)
    try:
        async with _api_client(current) as client:
            resp = await client.get(path, params=params)
            if resp.status_code == 401 and current.get("refresh_token"):
                refreshed = await refresh_tokens(current)
                if refreshed:
                    current = refreshed
                    async with _api_client(current) as retry_client:
                        resp = await retry_client.get(path, params=params)
    except httpx.HTTPError as exc:
        raise PmsError(502, f"SDU PMS API did not respond ({type(exc).__name__}).")

    try:
        payload = _unwrap(resp.json())
    except ValueError:
        payload = None
    return resp.status_code, payload, current


async def fetch_session_and_profile(tokens: dict, username: str = "") -> tuple[dict, dict]:
    """Read session-info and /me from pms-alpha-api.sdu.edu.kz."""
    status_sess, session_data, tokens = await _api_get(tokens, "/session-info")
    if status_sess == 401:
        raise PmsError(401, "PMS session expired. Sign in again.")
    if status_sess >= 400 or not isinstance(session_data, dict):
        raise PmsError(502, "Signed in to SDU PMS, but could not read session info. Try again.")

    status_me, me_data, tokens = await _api_get(tokens, "/me")
    info = {}
    if status_me == 200 and isinstance(me_data, dict):
        raw_info = me_data.get("information")
        info = raw_info if isinstance(raw_info, dict) else me_data

    employee_id = (
        session_data.get("employee_id")
        or session_data.get("employeeId")
        or info.get("employee_id")
        or info.get("employeeId")
        or info.get("id")
        or username
    )
    employee_id = str(employee_id).strip()
    if not employee_id:
        raise PmsError(502, "Signed in to SDU PMS, but could not determine your employee ID.")

    first = str(info.get("first_name") or info.get("firstname") or info.get("name") or "").strip()
    last = str(info.get("last_name") or info.get("lastname") or info.get("surname") or "").strip()
    combined = f"{first} {last}".strip()
    fullname = str(
        info.get("fullname")
        or info.get("full_name")
        or (combined if combined else "")
        or info.get("native")
        or username
        or f"Teacher {employee_id}"
    ).strip()

    email = info.get("email") or info.get("corporate_email")
    if not email and username:
        email = username if "@" in username else f"{username}@sdu.edu.kz"

    roles = session_data.get("roles") or []
    return {
        "employee_id": employee_id,
        "fullname": fullname,
        "email": email,
        "username": str(info.get("username") or username or "").strip(),
        "roles": roles,
        "year": session_data.get("year"),
        "term": session_data.get("term"),
    }, tokens


def _coerce_float(val) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace("%", "").replace(",", ".").strip())
    except ValueError:
        return None


def _extract_courses_list(payload) -> list[dict]:
    if isinstance(payload, list):
        return [c for c in payload if isinstance(c, dict)]
    if isinstance(payload, dict):
        for key in ("courses", "items", "data"):
            if isinstance(payload.get(key), list):
                return [c for c in payload[key] if isinstance(c, dict)]
    return []


def _extract_students_list(payload) -> list[dict]:
    if isinstance(payload, list):
        return [s for s in payload if isinstance(s, dict)]
    if isinstance(payload, dict):
        for key in ("students", "students_with_grades", "items", "data"):
            if isinstance(payload.get(key), list):
                return [s for s in payload[key] if isinstance(s, dict)]
    return []


def _normalize_student(raw: dict, course_title: str = "", course_code: str = "") -> Optional[dict]:
    sid = str(
        raw.get("student_id")
        or raw.get("studentId")
        or raw.get("stud_id")
        or raw.get("id")
        or ""
    ).strip()
    if not sid:
        return None
    first = str(raw.get("first_name") or raw.get("firstname") or "").strip()
    last = str(raw.get("last_name") or raw.get("lastname") or raw.get("surname") or "").strip()
    name = str(
        raw.get("fullname")
        or raw.get("full_name")
        or raw.get("student_name")
        or raw.get("name")
        or f"{first} {last}".strip()
        or f"Student {sid}"
    ).strip()
    cohort = str(
        raw.get("cohort")
        or raw.get("speciality")
        or raw.get("program")
        or raw.get("group")
        or (f"Class {raw['class']}" if raw.get("class") else "")
        or "SDU Student"
    ).strip()

    attendance = _coerce_float(raw.get("attendance") or raw.get("attendance_percent"))
    if attendance is None:
        absence = _coerce_float(raw.get("absence_percent") or raw.get("absent_percent"))
        if absence is not None:
            attendance = round(max(0.0, min(100.0, 100.0 - absence)), 1)

    grade_val = _coerce_float(
        raw.get("grade")
        or raw.get("total_grade")
        or raw.get("total")
        or raw.get("score")
    )
    grades = []
    if course_title and grade_val is not None:
        grades.append({
            "course": course_title,
            "code": course_code or course_title,
            "credits": int(_coerce_float(raw.get("ects") or raw.get("credits")) or 3),
            "score": round(grade_val, 1),
        })

    return {
        "id": sid,
        "name": name,
        "cohort": cohort,
        "attendance": attendance,
        "grades": grades,
    }


async def fetch_teacher_roster(tokens: dict, year: Optional[int] = None, term: Optional[int] = None) -> dict:
    """Best-effort fetch of teacher's courses and enrolled/advisory students from PMS."""
    params = {}
    if year is not None:
        params["year"] = year
    if term is not None:
        params["term"] = term

    courses: list[dict] = []
    students_by_id: dict[str, dict] = {}

    def merge_student(item: Optional[dict]) -> None:
        if not item:
            return
        cur = students_by_id.get(item["id"])
        if not cur:
            students_by_id[item["id"]] = item
            return
        if item.get("name") and cur["name"].startswith("Student "):
            cur["name"] = item["name"]
        if item.get("cohort") and cur["cohort"] == "SDU Student":
            cur["cohort"] = item["cohort"]
        if item.get("attendance") is not None:
            cur["attendance"] = item["attendance"]
        if item.get("grades"):
            existing_codes = {g["code"] for g in cur["grades"]}
            for g in item["grades"]:
                if g["code"] not in existing_codes:
                    cur["grades"].append(g)

    try:
        st, payload, tokens = await _api_get(tokens, "/academic/courses/my", params=params or None)
        if st == 200:
            courses = _extract_courses_list(payload)
    except PmsError:
        courses = []

    section_seen: set[str] = set()
    for course in courses:
        c_code = str(course.get("code") or course.get("course_code") or "").strip()
        c_title = str(course.get("courseTitle") or course.get("title") or course.get("name") or c_code).strip()
        sections = course.get("sections") if isinstance(course.get("sections"), list) else []
        section_ids = [
            str(s.get("section_id") or s.get("id"))
            for s in sections
            if isinstance(s, dict) and (s.get("section_id") or s.get("id"))
        ]
        if not section_ids and (course.get("section_id") or course.get("id")):
            section_ids = [str(course.get("section_id") or course.get("id"))]

        for sec_id in section_ids:
            if sec_id in section_seen or len(section_seen) >= 12:
                continue
            section_seen.add(sec_id)
            for ep in ("/academic/courses/students", "/academic/courses/grades"):
                try:
                    st, payload, tokens = await _api_get(tokens, ep, params={"section_id": sec_id})
                    if st == 200:
                        for raw in _extract_students_list(payload):
                            merge_student(_normalize_student(raw, c_title, c_code))
                except PmsError:
                    continue

    # Also include advisory students if the teacher is an advisor.
    try:
        st, payload, tokens = await _api_get(tokens, "/academic/students/my", params={"per_page": 50, "offset": 1})
        if st == 200:
            for raw in _extract_students_list(payload):
                merge_student(_normalize_student(raw))
    except PmsError:
        pass

    return {"courses": courses, "students": list(students_by_id.values()), "tokens": tokens}
