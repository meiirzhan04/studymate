"""Signing in through the SDU portal directly (app/sdu_portal.py), against a fake portal.

The fixture HTML mirrors the real my.sdu.edu.kz markup with made-up students and courses."""
import json
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from app import sdu_portal
from app.main import app, repo

client = TestClient(app)

LOGIN_PAGE = '<form method="post" action="loginAuth.php"><input name="username"><input name="password"></form>'
VERIFY_PAGE = ('<form method="post" action="https://my.sdu.edu.kz/verification.php"><input name="code">'
               '<p class="verify-notice"><em>Кіру коды (t...@mail.test) электрондық поштасына жіберілді.</em></p></form>')
HOME_PAGE = """<table>
<tr><td class="clsTd">Student № :</td><td class="clsTd">200000001</td></tr>
<tr><td class="clsTd">Fullname :</td><td class="clsTd">Test Student</td></tr>
<tr><td class="clsTd">Program / Class :</td><td class="clsTd">Information Systems (EN) - 2</td></tr>
<tr><td class="clsTd">Status :</td><td class="clsTd">Studying</td></tr>
<tr><td class="clsTd">Email :</td><td class="clsTd">test.student@mail.test</td></tr>
</table>"""
GRADES_PAGE = '<select id="ysem"><option value="2025#2">x</option><option value="2026#1" selected>y</option></select>'
GRADES_DATA = """<table id="coursesTable" class="ctbl"><tbody>
<tr height="30px"><td class="thtext" colspan="10"><b>2026-2027 1. term</b></td></tr>
<tr class="csrow "><td class="crtd"><div class="plus"></div><div>1</div></td>
<td class="crtd"><div>INF 101</div><div class="smalltxt"></div></td>
<td class="crtd alignleft">Intro to Testing</td><td class="crtd">3</td><td class="crtd">5</td>
<td class="crtd">4&nbsp;%</td><td class="crtd">78</td><td class="crtd">B-</td><td class="crtd last"></td><td class="crtd last"></td></tr>
<tr class="hidden"><td colspan="10"><table class="ctbl"><tbody><tr><td valign="top"><table class="ctbl"><tbody>
<tr><th colspan="3" class="chtd">Section: 01 - Theory (N)</th></tr>
<tr><td class="crtd">Assesment</td><td class="crtd">Grades</td><td class="crtd">Average</td></tr>
<tr><td class="crtd">MT (30/100)</td><td class="crtd">80</td><td class="crtd">71.5</td></tr>
<tr><td class="crtd">FIN (70/100)</td><td class="crtd"></td><td class="crtd"></td></tr>
</tbody></table></td></tr></tbody></table></td></tr>
<tr class="csrow "><td class="crtd"><div class="plus"></div><div>2</div></td>
<td class="crtd"><div>MDE 200</div></td><td class="crtd alignleft">Law</td><td class="crtd">3</td><td class="crtd">5</td>
<td class="crtd">0&nbsp;%</td><td class="crtd"></td><td class="crtd">IP</td><td class="crtd last"></td><td class="crtd last"></td></tr>
<tr class="hidden"><td colspan="10"><table class="ctbl"><tbody><tr><td>There are no assessments in this section</td></tr></tbody></table></td></tr>
</tbody></table>"""
TRANSCRIPT_PAGE = """<table>
<tr><td>course code</td><td>course title</td><td>credit</td><td>ects</td><td>grade</td><td>letter grade</td><td>point</td><td>traditional</td></tr>
<tr><td colspan="8">2025 - 2026. 1</td></tr>
<tr><td>CSS 100</td><td>Programming Basics</td><td>3</td><td>5</td><td>90</td><td>A-</td><td>3.67</td><td>Excellent</td></tr>
<tr><td>MDE 100</td><td>English</td><td>5</td><td>6</td><td>72</td><td>P</td><td></td><td>Pass</td></tr>
<tr><td></td><td></td><td>8</td><td>11</td><td>SA : 81</td><td>GA : 81</td><td>SPA : 3.67</td><td>GPA : 3.67</td></tr>
<tr><td colspan="8">2025 - 2026. 2</td></tr>
<tr><td>INF 120</td><td>Databases</td><td>3</td><td>5</td><td>45</td><td>F</td><td>0</td><td>Fail</td></tr>
</table>"""
SCHEDULE_PAGE = '<select id="ysem"><option value="1#1">all</option><option value="2026#1" selected>now</option></select>'
SCHEDULE_DATA = """<table>
<tr><td>Day/Hour</td><td>Mo</td><td>Tu</td><td>We</td><td>Th</td><td>Fr</td><td>Sa</td></tr>
<tr><td><span>08:30</span><br><span>09:20</span></td><td></td><td></td><td></td>
<td><a title="INF 101 Intro to Testing (2+1+0) [3cr / 5ECTS]">INF 101</a><span>Intro to Testing (2+1+0) [3cr / 5ECTS]<br></span>
<span title="Theory">[01-N]</span><img title="Test Teacher" src="images/stud_icon.png"><span><br>Test Teacher</span><br>
<img title="Main building - Engineering block: I 310, I 311(I 310, I 311)" src="images/house.gif">:
<span>Main building - Engineering block: (I 310, I 311)</span><span title="Main building - Engineering block: I 310, I 311(I 310, I 311)">I 310, I 311</span></td>
<td></td><td></td></tr>
<tr><td><span>09:30</span><br><span>10:20</span></td>
<td><a title="MDE 200 Law (2+1+0) [3cr / 5ECTS]">MDE 200</a><span>Law (2+1+0) [3cr / 5ECTS]<br></span>
<span title="Practice">[05-P]</span><img title="Other Teacher" src="images/stud_icon.png"><span><br>Other Teacher</span><br>
<img title="Main building: H 01(H 01)" src="images/house.gif">:<span>Main building: (H 01)</span><span title="Main building: H 01(H 01)">H 01</span></td>
<td></td><td></td><td></td><td></td><td></td></tr>
</table>"""
ATTENDANCE_PAGE = """<select><option value="2026#1" selected>2026 - 2027 ( 1 )</option></select><table>
<tr><td></td><td>Code</td><td>Course name</td><td>Credits</td><td>ECTS</td><td>Hours</td><td>P</td><td>A</td><td>E</td><td>Absence %</td></tr>
<tr><td>1</td><td>INF 101</td><td>Intro to Testing</td><td>2+1+0</td><td>5</td><td>45</td><td>20</td><td>2</td><td>0</td><td>4%</td></tr>
<tr><td>2</td><td>MDE 200</td><td>Law</td><td>2+1+0</td><td>5</td><td>45</td><td>0</td><td>0</td><td>0</td><td>N/A</td></tr>
</table>"""


class FakePortal:
    """Login sets a pending session; the emailed code (123456) upgrades it and trusts the device."""

    def __init__(self):
        self.password = "right-password"
        self.require_code = True
        self.requests = []
        self.journal = ATTENDANCE_PAGE
        self.course_journals = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        cookies = dict(item.split("=", 1) for item in request.headers.get("cookie", "").split("; ") if "=" in item)
        query = parse_qs(request.url.query.decode())
        path = request.url.path
        self.requests.append((request.method, path, query.get("mod", [""])[0], query.get("action", [""])[0]))
        if path == "/loginAuth.php" and request.method == "POST":
            form = parse_qs(request.content.decode())
            if form.get("password", [""])[0] != self.password:
                return httpx.Response(200, html=LOGIN_PAGE + '<div class="error">Wrong password</div>')
            if self.require_code and cookies.get("trusted") != "yes":
                return httpx.Response(302, headers={"location": "/verification.php", "set-cookie": "PHPSESSID=pending; path=/"})
            return httpx.Response(302, headers={"location": "/index.php", "set-cookie": "PHPSESSID=good; path=/"})
        if path == "/verification.php" and request.method == "POST":
            if cookies.get("PHPSESSID") != "pending":
                return httpx.Response(302, headers={"location": "/loginAuth.php"})
            if parse_qs(request.content.decode()).get("code", [""])[0] != "123456":
                return httpx.Response(200, html=VERIFY_PAGE)
            return httpx.Response(302, headers=[("location", "/index.php"), ("set-cookie", "PHPSESSID=good; path=/"),
                                                ("set-cookie", "trusted=yes; path=/")])
        if path == "/verification.php":
            return httpx.Response(200, html=VERIFY_PAGE)
        if path == "/loginAuth.php":
            return httpx.Response(200, html=LOGIN_PAGE)
        if cookies.get("PHPSESSID") != "good":
            return httpx.Response(200, html=LOGIN_PAGE)
        mod = query.get("mod", [""])[0]
        if request.method == "POST" and path == "/index.php":
            # Like the real portal: AJAX parameters only count in the form body, and CODE is a string
            form = parse_qs(request.content.decode())
            action = form.get("action", [""])[0]
            if action == "GetGrades" and form.get("yt") == ["2026#1"]:
                return httpx.Response(200, text=json.dumps({"CODE": "1", "DATA": GRADES_DATA}))
            if action == "viewCourse":
                key = (form.get("derskod", [""])[0], form.get("year", [""])[0], form.get("term", [""])[0], form.get("stud_id", [""])[0])
                if key in self.course_journals:
                    return httpx.Response(200, text=json.dumps({"CODE": 1, "DATA": self.course_journals[key]}))
                return httpx.Response(200, text=json.dumps({"CODE": -1, "DATA": "No sections"}))
            if action == "showSchedule" and form.get("year") == ["2026"] and form.get("term") == ["1"]:
                return httpx.Response(200, html=SCHEDULE_DATA)
            return httpx.Response(200, text="")
        pages = {"": HOME_PAGE, "grades": GRADES_PAGE, "transkript": TRANSCRIPT_PAGE, "ejurnal": self.journal,
                 "schedule": SCHEDULE_PAGE}
        return httpx.Response(200, html=pages.get(mod, HOME_PAGE))


@pytest.fixture
def portal(monkeypatch):
    fake = FakePortal()
    monkeypatch.setenv("ENABLE_PORTAL_LOGIN", "1")
    monkeypatch.setattr(sdu_portal, "TRANSPORT", httpx.MockTransport(fake))
    return fake


def auth(value): return {"Authorization": f"Bearer {value}"}


def sign_in(portal):
    step = client.post("/api/sdu/portal/login", json={"student_id": "200000001", "password": portal.password})
    assert step.status_code == 200, step.text
    if step.json().get("verification_required"):
        assert step.json()["notice"] == "SDU sent a 6-digit code to t...@mail.test. Check Spam if it isn't in your inbox."
        step = client.post("/api/sdu/portal/verify", json={"pending": step.json()["pending"], "code": "123456"})
        assert step.status_code == 200, step.text
    return step.json()


def test_portal_login_is_on_by_default_and_can_be_turned_off(monkeypatch):
    monkeypatch.delenv("ENABLE_PORTAL_LOGIN", raising=False)
    assert client.get("/api/sdu/portal/config").json() == {"enabled": True}
    monkeypatch.setenv("ENABLE_PORTAL_LOGIN", "0")
    assert client.get("/api/sdu/portal/config").json() == {"enabled": False}
    res = client.post("/api/sdu/portal/login", json={"student_id": "200000001", "password": "x"})
    assert res.status_code == 404


def test_portal_sign_in_with_emailed_code_creates_an_sdu_user(portal):
    data = sign_in(portal)
    assert data["sdu_connected"] is True and data["source"] == "portal"
    assert data["user"]["student_id"] == "200000001"
    conn = repo.get_sdu_connection(data["user"]["id"])
    assert conn["access_token"].startswith(sdu_portal.TOKEN_PREFIX)
    # Only encrypted cookies are stored, never the password
    assert portal.password not in conn["access_token"] and "good" not in conn["access_token"]
    assert sdu_portal.unseal(conn["access_token"][len(sdu_portal.TOKEN_PREFIX):])["PHPSESSID"] == "good"


def test_a_studymate_password_signs_in_through_the_same_form_without_the_portal(portal):
    repo.create_user(name="Local Student", identifier="200000009", password="local-pass-1", role="student")
    res = client.post("/api/sdu/portal/login", json={"student_id": "200000009", "password": "local-pass-1"})
    assert res.status_code == 200 and res.json()["user"]["student_id"] == "200000009"
    assert not any(path == "/loginAuth.php" for _, path, _, _ in portal.requests)


def test_wrong_password_and_wrong_code_are_rejected(portal):
    bad = client.post("/api/sdu/portal/login", json={"student_id": "200000002", "password": "nope"})
    assert bad.status_code == 400 and bad.json()["detail"] == "Wrong password"
    step = client.post("/api/sdu/portal/login", json={"student_id": "200000002", "password": portal.password})
    wrong = client.post("/api/sdu/portal/verify", json={"pending": step.json()["pending"], "code": "000000"})
    assert wrong.status_code == 400 and "code" in wrong.json()["detail"]
    tampered = client.post("/api/sdu/portal/verify", json={"pending": "x" * 40, "code": "123456"})
    assert tampered.status_code == 400


def test_portal_data_reaches_the_app_in_api_sdu_shapes(portal):
    tok = sign_in(portal)["access_token"]
    profile = client.get("/api/sdu/profile", headers=auth(tok)).json()
    assert profile["fullname"] == "Test Student" and profile["course_year"] == 2

    transcript = client.get("/api/sdu/transcript", headers=auth(tok)).json()
    courses = transcript.get("courses", transcript)
    assert [(c["semester"], c["course_code"], c["letter_grade"], c["passed"]) for c in courses] == [
        (1, "CSS 100", "A-", True), (1, "MDE 100", "P", True), (2, "INF 120", "F", False)]

    attendance = client.get("/api/sdu/attendance?year=2026&term=1", headers=auth(tok)).json()
    rows = attendance.get("attendance", attendance)
    assert [(r["lesson"], r["absence_percent"]) for r in rows] == [("Intro to Testing", 4.0), ("Law", None)]

    conn_token = repo.get_sdu_connection(client.get("/api/me", headers=auth(tok)).json()["id"])["access_token"]
    status, grades = _run(sdu_portal.fetch("grades", conn_token, {"year": 2026, "term": 1}))
    assert status == 200
    first, second = grades["grades"]
    assert (first["course_code"], first["grade"], first["letter_grade"], first["absence_percent"]) == ("INF 101", 78.0, "B-", 4.0)
    assert first["components"] == [{"name": "MT", "weight": 30.0, "score": 80.0, "average": 71.5},
                                   {"name": "FIN", "weight": 70.0, "score": None, "average": None}]
    assert (second["grade"], second["letter_grade"], second["components"]) == (None, "IP", [])

    # Without a term the current one is read from the page; rows are periods, columns weekdays
    status, schedule = _run(sdu_portal.fetch("schedule", conn_token))
    assert status == 200
    assert schedule["schedule"] == [
        {"course_code": "INF 101", "course_name": "Intro to Testing", "section": "01", "lesson_type": "Theory",
         "weekday": "Thursday", "start_time": "08:30:00", "end_time": "09:20:00",
         "building": "Main building - Engineering block", "room": "I 310, I 311", "teacher": "Test Teacher",
         "is_online": False, "year": 2026, "term": 1},
        {"course_code": "MDE 200", "course_name": "Law", "section": "05", "lesson_type": "Practice",
         "weekday": "Monday", "start_time": "09:30:00", "end_time": "10:20:00",
         "building": "Main building", "room": "H 01", "teacher": "Other Teacher",
         "is_online": False, "year": 2026, "term": 1},
    ]
    assert client.get("/api/sdu/schedule", headers=auth(tok)).status_code == 200


def test_attendance_falls_back_to_grades_when_the_journal_page_has_no_rows(portal):
    # Seen live: the journal page answers without course rows while GetGrades still lists absence per course
    portal.journal = '<select><option value="2026#1" selected>2026 - 2027 ( 1 )</option></select><table></table>'
    tok = sign_in(portal)["access_token"]
    attendance = client.get("/api/sdu/attendance?year=2026&term=1", headers=auth(tok)).json()
    assert [(r["course_code"], r["lesson"], r["absence_percent"], r["year"], r["term"]) for r in attendance["attendance"]] == [
        ("INF 101", "Intro to Testing", 4.0, 2026, 1), ("MDE 200", "Law", 0.0, 2026, 1)]


def test_a_trusted_device_skips_the_code_on_the_next_sign_in(portal):
    tok = sign_in(portal)["access_token"]
    again = client.post("/api/sdu/portal/login", headers=auth(tok),
                        json={"student_id": "200000001", "password": portal.password})
    assert again.status_code == 200 and again.json()["sdu_connected"] is True


def test_expired_portal_session_asks_to_reconnect_and_disconnect_skips_api_sdu(portal, monkeypatch):
    data = sign_in(portal)
    conn = repo.get_sdu_connection(data["user"]["id"])
    expired = sdu_portal.connection_token({"PHPSESSID": "gone"})
    assert _run(sdu_portal.fetch("profile", expired))[0] == 401
    assert _run(sdu_portal.fetch("moodle/deadlines", conn["access_token"]))[0] == 404

    from app import sdu_client
    revoked = []

    async def no_revoke(token, client=None):
        revoked.append(token)
    monkeypatch.setattr(sdu_client, "revoke_token", no_revoke)
    assert client.post("/api/sdu/disconnect", headers=auth(data["access_token"])).status_code == 200
    assert revoked == []


def _run(coro):
    import asyncio
    return asyncio.run(coro)


# ─── Electronic attendance journal (the real page loads each course with viewCourse) ──
JOURNAL_PICKER = """<select id="ysem"><option value="0#0">Choose</option><option value="2026#1" selected>2026 - 2027 ( 1 )</option></select>
<input type="hidden" id="stud_id" value="200000001"><div id="divCont"></div>"""


def journal_section(chart, rows, hours):
    """One section the way viewCourse renders it: a row per class hour, a check, a cross or nothing."""
    icons = {"present": '<img title="Attended" src="images/check.png">', "absent": '<img title="Absent" src="images/cross.png">',
             "permitted": '<img title="Permitted" src="images/permit.png">', None: ""}
    body = "".join(
        f'<tr><td class="clsTd">{i}</td><td class="clsTd">{day.strftime("%d.%m.%Y")}</td><td class="clsTd">14:30</td>'
        f'<td class="clsTd">I 310</td><td class="clsTd">{icons[status]}</td></tr>'
        for i, (day, status) in enumerate(rows, start=1))
    return (f'<div class="crsTit"><span class="grpTitle">01 - Test Teacher</span></div>'
            f'<div class="crsTit"><span class="grpTitle"> 15 <span class="sSpn">(Week)</span>, {hours} <span class="sSpn">(Hours)</span></span></div>'
            f'<table id="tblJourn" class="clsTbl"><tr><td></td><td><b>Date</b></td><td><b>Hour</b></td><td><b>Room</b></td><td><b>Attendance</b></td></tr>{body}</table>')


def test_attendance_hours_come_from_each_course_journal(portal):
    from datetime import date, timedelta
    today = date.today()
    past = [today - timedelta(days=d) for d in (40, 33, 26, 19, 12, 5)]
    ahead = [today + timedelta(days=d) for d in (2, 9, 16)]
    rows = list(zip(past, [None, "present", "present", "absent", "permitted", "present"])) + [(d, None) for d in ahead]
    pie = '<input id="pieInput" type="" style="visibility: hidden;" value="pie01,3,1,1,4,9">'
    portal.journal = JOURNAL_PICKER
    portal.course_journals[("INF 101", "2026", "1", "200000001")] = journal_section("pie01", rows, 9) + pie
    tok = sign_in(portal)["access_token"]
    rows_out = client.get("/api/sdu/attendance?year=2026&term=1", headers=auth(tok)).json()["attendance"]
    inf = next(r for r in rows_out if r["course_code"] == "INF 101")
    # 9 scheduled hours: 3 attended, 1 absent, 1 excused, an unmarked past hour, 3 still ahead
    assert (inf["hours"], inf["present"], inf["absent"], inf["permitted"], inf["remaining"]) == (9, 3, 1, 1, 3)
    law = next(r for r in rows_out if r["course_code"] == "MDE 200")       # its journal answers CODE -1
    assert law["hours"] is None and law["absence_percent"] == 0.0
    assert any(action == "viewCourse" for _m, _p, _mod, action in portal.requests)


def test_course_journal_counts_without_the_chart_input():
    from datetime import date
    today = date(2026, 11, 9)
    rows = [(date(2026, 9, 3), None), (date(2026, 9, 10), "present"), (date(2026, 10, 8), "absent"),
            (date(2026, 11, 12), None), (date(2026, 11, 19), None)]
    counts = sdu_portal.parse_course_journal(journal_section("pie01", rows, 5), today=today)
    assert counts == {"present": 1, "absent": 1, "permitted": 0, "unmarked": 3, "hours": 5, "remaining": 2}
    assert sdu_portal.parse_course_journal("<p>No sections</p>") is None


def test_journal_hours_make_attendance_goals_exact():
    from app import goals
    # SDU: 1 absent hour of 45 is the 2% on the attendance page; 15 hours are still ahead
    row = {"lesson": "Mobile", "hours": 45, "present": 20, "absent": 1, "permitted": 0, "remaining": 15, "absence_percent": 2.0}
    assert goals.evaluate_attendance_course(row, 98)["maximum"] == 97.7
    out = goals.evaluate_attendance_course(row, 95)
    assert out["remaining"] == 15 and out["affordable"] == 1 and out["must_attend"] == 14
