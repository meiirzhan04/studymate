"""Direct client for the SDU student portal (my.sdu.edu.kz), an alternative to the api-sdu gateway.

The portal has no public API: we sign in with the student's own number and password, pass the
emailed two-factor code, and read the same pages the student sees. The password is used once and
never stored; the connection keeps only the portal cookies, encrypted. Data is returned in the
api-sdu shapes (see sdu_mock.py) so the rest of the app does not care which source it came from.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
from datetime import datetime, timezone
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from cryptography.fernet import Fernet, InvalidToken

PORTAL_ORIGIN = os.getenv("SDU_PORTAL_ORIGIN", "https://my.sdu.edu.kz").rstrip("/")
TOKEN_PREFIX = "portal:"
SOURCE = "sdu_portal"
PENDING_TTL_SECONDS = 10 * 60  # the emailed code has to be entered within this window
TIMEOUT = httpx.Timeout(20.0, connect=8.0)
COURSE_CODE = re.compile(r"^[A-Z]{2,4}\s?\d{3}[A-Z]?$")
TERM_HEADER = re.compile(r"^(\d{4})\s*-\s*(\d{4})\s*\.\s*(\d)$")
EXPIRED = (401, {"detail": "Invalid or expired token"})


def portal_enabled() -> bool:
    """On by default (the api-sdu gateway fails at its own 2FA step); ENABLE_PORTAL_LOGIN=0 turns it off."""
    return os.getenv("ENABLE_PORTAL_LOGIN", "1") != "0"


def is_portal_token(access_token: Optional[str]) -> bool:
    return bool(access_token) and access_token.startswith(TOKEN_PREFIX)


# ─── Encrypted cookie jar ──────────────────────────────────────────

def _fernet() -> Fernet:
    secret = os.getenv("PORTAL_SECRET") or os.getenv("AUTH_SECRET") or "studymate-dev-secret"
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(f"sdu-portal:{secret}".encode()).digest()))


def seal(cookies: dict) -> str:
    import json
    return _fernet().encrypt(json.dumps(cookies).encode()).decode()


def unseal(sealed: str, ttl: Optional[int] = None) -> Optional[dict]:
    import json
    try:
        data = json.loads(_fernet().decrypt(sealed.encode(), ttl=ttl))
    except (InvalidToken, ValueError):
        return None
    return data if isinstance(data, dict) else None


def connection_token(cookies: dict) -> str:
    return TOKEN_PREFIX + seal(cookies)


# ─── Sign-in ───────────────────────────────────────────────────────

class PortalError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


TRANSPORT: Optional[httpx.AsyncBaseTransport] = None  # tests swap in an httpx.MockTransport


def _client(cookies: Optional[dict] = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=PORTAL_ORIGIN, cookies=cookies or {}, timeout=TIMEOUT, transport=TRANSPORT,
                             follow_redirects=True, headers={"User-Agent": "StudyMate/1.0"})


def _jar(client: httpx.AsyncClient) -> dict:
    return {cookie.name: cookie.value for cookie in client.cookies.jar}


def _is_login_page(resp: httpx.Response) -> bool:
    return "loginAuth.php" in str(resp.url) or 'action="loginAuth.php"' in resp.text


def _is_verification_page(resp: httpx.Response) -> bool:
    return "verification.php" in str(resp.url) or 'name="code"' in resp.text


def _notice(html: str) -> Optional[str]:
    node = _soup(html).select_one(".verify-notice")
    return node.get_text(" ", strip=True) if node else None


def _login_error(html: str) -> str:
    soup = _soup(html)
    for selector in (".error", ".errMsg", "font[color=red]", ".alert"):
        node = soup.select_one(selector)
        if node and node.get_text(strip=True):
            return node.get_text(" ", strip=True)
    return "Wrong student number or password."


async def login(student_id: str, password: str, cookies: Optional[dict] = None) -> dict:
    """Returns {"state": "ok", "cookies"} or {"state": "verify", "pending", "notice"}.

    `cookies` from an earlier connection are sent along, so a device the portal already trusts
    can skip the emailed code."""
    try:
        async with _client(cookies) as client:
            await client.get("/index.php", params={"lng": "en"})
            resp = await client.post("/loginAuth.php", data={
                "username": student_id, "password": password, "modstring": "", "LogIn": " Log in ",
            })
            jar = _jar(client)
    except httpx.HTTPError as exc:
        raise PortalError(502, f"SDU portal did not respond ({type(exc).__name__}). Try again in a minute.")
    if _is_verification_page(resp):
        return {"state": "verify", "pending": seal(jar), "notice": _notice(resp.text)}
    if _is_login_page(resp):
        raise PortalError(401, _login_error(resp.text))
    return {"state": "ok", "cookies": jar}


async def verify(pending: str, code: str) -> dict:
    jar = unseal(pending, ttl=PENDING_TTL_SECONDS)
    if jar is None:
        raise PortalError(400, "The verification step expired. Sign in again.")
    try:
        async with _client(jar) as client:
            resp = await client.post("/verification.php", data={"code": code, "LogIn": ""})
            jar = _jar(client)
    except httpx.HTTPError as exc:
        raise PortalError(502, f"SDU portal did not respond ({type(exc).__name__}). Try again in a minute.")
    if _is_verification_page(resp):
        raise PortalError(401, "Wrong verification code. Check the latest email from SDU.")
    if _is_login_page(resp):
        raise PortalError(400, "The verification step expired. Sign in again.")
    return {"state": "ok", "cookies": jar}


# ─── Page parsers ──────────────────────────────────────────────────

def _soup(html: str) -> BeautifulSoup:
    # lxml, not html.parser: the portal's attendance markup is loose enough that html.parser loses its rows
    return BeautifulSoup(html, "lxml")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(node) -> str:
    return node.get_text(" ", strip=True).replace("\xa0", " ").strip() if node else ""


def _number(value: str) -> Optional[float]:
    match = re.search(r"-?\d+(?:[.,]\d+)?", value or "")
    return float(match.group(0).replace(",", ".")) if match else None


def _cells(row) -> list[str]:
    return [_text(c) for c in row.find_all(["td", "th"], recursive=False)]


def parse_profile(html: str) -> dict:
    fields = {}
    for row in _soup(html).find_all("tr"):
        cells = _cells(row)
        if len(cells) == 2 and cells[0].endswith(":"):
            fields[cells[0].rstrip(":").strip().lower()] = cells[1]
    student_id = next((v for k, v in fields.items() if k.startswith("student")), "")
    program = fields.get("program / class", "")
    return {
        "student_id": student_id.strip(),
        "fullname": fields.get("fullname", ""),
        "email": fields.get("email") or None,
        "program": re.sub(r"\s*-\s*\d+$", "", program) or None,
        "course_year": int(m.group(1)) if (m := re.search(r"-\s*(\d+)$", program)) else None,
        "advisor": fields.get("advisor") or None,
        "status": fields.get("status") or None,
    }


def parse_transcript(html: str) -> list[dict]:
    courses, semester = [], 0
    for row in _soup(html).find_all("tr"):
        cells = _cells(row)
        if not cells:
            continue
        if len(cells) <= 2 and TERM_HEADER.match(cells[0]):
            semester += 1
            continue
        if semester and len(cells) >= 7 and COURSE_CODE.match(cells[0]):
            code, name, credits, ects, grade, letter, point = cells[:7]
            percent = _number(grade)
            courses.append({
                "semester": semester, "course_code": code, "course_name": name,
                "credits": _number(credits), "ects": _number(ects),
                "grade": percent, "grade_percent": percent, "letter_grade": letter or None,
                "grade_point": _number(point), "passed": bool(letter) and letter not in ("F", "FX", "IP"),
            })
    return courses


def parse_attendance(html: str, year: int, term: int) -> list[dict]:
    items = []
    for row in _soup(html).find_all("tr"):
        cells = _cells(row)
        if len(cells) >= 10 and COURSE_CODE.match(cells[1]):
            items.append({
                "lesson": cells[2], "course_code": cells[1], "year": year, "term": term,
                "absence_percent": _number(cells[-1]), "hours": _number(cells[5]),
                "present": _number(cells[6]), "absent": _number(cells[7]), "permitted": _number(cells[8]),
                "updated_at": _now(),
            })
    return items


def _assessments(detail_row) -> list[dict]:
    parts = []
    if detail_row is None:
        return parts
    for section in detail_row.find_all("table"):
        if section.find("table"):
            continue  # only the innermost tables hold assessment rows
        for row in section.find_all("tr"):
            cells = _cells(row)
            match = re.match(r"^(.+?)\s*\((\d+(?:\.\d+)?)\s*/\s*100\)$", cells[0]) if len(cells) == 3 else None
            if match:
                parts.append({"name": match.group(1), "weight": float(match.group(2)), "score": _number(cells[1]),
                              "average": _number(cells[2])})
    return parts


def parse_grades(html: str, year: int, term: int) -> list[dict]:
    items = []
    for row in _soup(html).select("tr.csrow"):
        cells = _cells(row)
        if len(cells) < 8:
            continue
        code = row.find_all("td", recursive=False)[1].find("div")
        detail = row.find_next_sibling("tr")
        letter = cells[7] or None
        items.append({
            "lesson": cells[2], "course_code": _text(code) or cells[1], "year": year, "term": term,
            "credits": _number(cells[3]), "ects": _number(cells[4]), "absence_percent": _number(cells[5]),
            "grade": _number(cells[6]), "letter_grade": letter,
            "components": _assessments(detail if detail is not None and "csrow" not in (detail.get("class") or []) else None),
            "updated_at": _now(),
        })
    return items


WEEKDAYS = {"mo": "Monday", "tu": "Tuesday", "we": "Wednesday", "th": "Thursday", "fr": "Friday", "sa": "Saturday", "su": "Sunday"}


def _lesson(cell, weekday: str, start: str, end: str, year: int, term: int) -> Optional[dict]:
    link = cell.find("a")
    if link is None:
        return None
    code = "".join(link.find_all(string=True, recursive=False)).strip() or _text(link).split("(")[0].strip()
    title = link.get("title", "")
    name = re.sub(r"\s*\(\d+\+\d+\+\d+\).*$", "", title[len(code):] if title.startswith(code) else title).strip()
    kind = next((s for s in cell.find_all("span", title=True) if re.match(r"^\[\d+-\w+\]$", _text(s))), None)
    teacher = next((img.get("title") for img in cell.find_all("img") if "stud_icon" in img.get("src", "")), None)
    place = next((img.get("title", "") for img in cell.find_all("img") if "house" in img.get("src", "")), "")
    room_span = cell.find_all("span", title=True)[-1] if cell.find_all("span", title=True) else None
    room = _text(room_span) if room_span is not None and room_span is not kind else None
    return {
        "course_code": code, "course_name": name or code,
        "section": re.sub(r"^\[(\d+)-.*$", r"\1", _text(kind)) if kind else None,
        "lesson_type": kind.get("title") if kind else None,
        "weekday": weekday, "start_time": f"{start}:00", "end_time": f"{end}:00",
        "building": place.split(":")[0].strip() or None, "room": room, "teacher": teacher,
        "is_online": "online" in place.lower(), "year": year, "term": term,
    }


def parse_schedule(html: str, year: int, term: int) -> list[dict]:
    """One item per period: rows are time slots, columns are weekdays (Mo..Sa)."""
    table = _soup(html).find("table")
    if table is None:
        return []
    rows = table.find_all("tr", recursive=False) or table.find_all("tr")
    days = [WEEKDAYS.get(_text(c).lower()[:2]) for c in rows[0].find_all(["td", "th"], recursive=False)] if rows else []
    items = []
    for row in rows[1:]:
        cells = row.find_all(["td", "th"], recursive=False)
        times = re.findall(r"\d{2}:\d{2}", _text(cells[0])) if cells else []
        if len(times) < 2:
            continue
        for index, cell in enumerate(cells[1:], start=1):
            weekday = days[index] if index < len(days) else None
            lesson = _lesson(cell, weekday, times[0], times[1], year, term) if weekday else None
            if lesson:
                items.append(lesson)
    return items


# ─── Reading data ──────────────────────────────────────────────────

def _term(params: Optional[dict]) -> Optional[tuple[int, int]]:
    if params and params.get("year") and params.get("term"):
        return int(params["year"]), int(params["term"])
    return None


async def fetch(endpoint: str, access_token: str, params: Optional[dict] = None) -> tuple[int, dict]:
    """Same contract as sdu_client.fetch_sdu_data, served from the portal pages."""
    jar = unseal(access_token[len(TOKEN_PREFIX):])
    if jar is None:
        return EXPIRED
    endpoint = endpoint.strip("/")
    try:
        async with _client(jar) as client:
            if endpoint == "profile":
                resp = await client.get("/index.php", params={"lng": "en"})
                if _is_login_page(resp) or _is_verification_page(resp):
                    return EXPIRED
                return 200, {"source": SOURCE, "fetched_at": _now(), **parse_profile(resp.text)}
            if endpoint == "transcript":
                resp = await client.get("/index.php", params={"mod": "transkript", "lng": "en"})
                if _is_login_page(resp):
                    return EXPIRED
                return 200, {"source": SOURCE, "fetched_at": _now(), "courses": parse_transcript(resp.text)}
            if endpoint == "attendance":
                resp = await client.get("/index.php", params={"mod": "ejurnal", "lng": "en"})
                if _is_login_page(resp):
                    return EXPIRED
                current = _selected_term(resp.text)
                wanted = _term(params)
                if wanted and current and wanted != current:
                    return 404, {"detail": "past_term_not_supported", "message": "The portal source shows the current term only."}
                year, term = current or wanted or (0, 0)
                return 200, {"source": SOURCE, "fetched_at": _now(), "attendance": parse_attendance(resp.text, year, term)}
            if endpoint == "grades":
                wanted = _term(params)
                if not wanted:
                    page = await client.get("/index.php", params={"mod": "grades", "lng": "en"})
                    if _is_login_page(page):
                        return EXPIRED
                    wanted = _selected_term(page.text)
                if not wanted:
                    return 502, {"detail": "invalid_upstream_response", "message": "Could not find the current term on the portal."}
                year, term = wanted
                # The portal reads these from the form body; in the query string it answers with nothing
                resp = await client.post("/index.php", data={
                    "mod": "grades", "ajx": "1", "action": "GetGrades", "yt": f"{year}#{term}"})
                if _is_login_page(resp):
                    return EXPIRED
                try:
                    payload = resp.json()
                except ValueError:
                    return 502, {"detail": "invalid_upstream_response", "message": "The portal returned an unexpected grades page."}
                if str(payload.get("CODE")) != "1":
                    return 502, {"detail": "upstream_error", "message": str(payload.get("DATA") or "The portal refused the grades request.")}
                return 200, {"source": SOURCE, "fetched_at": _now(), "grades": parse_grades(payload.get("DATA") or "", year, term)}
            if endpoint == "schedule":
                wanted = _term(params)
                if not wanted:
                    page = await client.get("/index.php", params={"mod": "schedule", "lng": "en"})
                    if _is_login_page(page):
                        return EXPIRED
                    wanted = _selected_term(page.text)
                if not wanted:
                    return 502, {"detail": "invalid_upstream_response", "message": "Could not find the current term on the portal."}
                year, term = wanted
                resp = await client.post("/index.php", data={
                    "mod": "schedule", "ajx": "1", "action": "showSchedule", "year": str(year), "term": str(term),
                    "type": "I", "details": "0"})
                if _is_login_page(resp):
                    return EXPIRED
                return 200, {"source": SOURCE, "fetched_at": _now(), "schedule": parse_schedule(resp.text, year, term)}
    except httpx.TimeoutException:
        return 504, {"detail": "upstream_timeout", "message": "SDU portal read timed out."}
    except httpx.HTTPError as exc:
        return 502, {"detail": "upstream_unavailable", "message": f"SDU portal unavailable ({type(exc).__name__})."}
    # Moodle deadlines are not on the portal
    return 404, {"detail": "not_supported_by_portal", "message": f"'{endpoint}' is not available from the SDU portal source."}


def _selected_term(html: str) -> Optional[tuple[int, int]]:
    soup = _soup(html)
    # The selected term, else the first real one (lists start with placeholders such as "0#0" or "1#1")
    for selector in ("select option[selected]", "select option"):
        for option in soup.select(selector):
            match = re.match(r"^(\d{4})#(\d)$", option.get("value", ""))
            if match:
                return int(match.group(1)), int(match.group(2))
    header = soup.find(string=re.compile(r"\d{4}\s*-\s*\d{4}\s*\.?\s*\d\.?\s*term", re.I))
    if header and (m := re.search(r"(\d{4})\s*-\s*\d{4}\s*\.?\s*(\d)", header)):
        return int(m.group(1)), int(m.group(2))
    return None
