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
               '<p class="verify-notice"><em>Code sent to t...@mail.test</em></p></form>')
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
        if request.method == "POST" and query.get("action", [""])[0] == "GetGrades":
            assert query["yt"] == ["2026#1"]
            return httpx.Response(200, text=json.dumps({"CODE": 1, "DATA": GRADES_DATA}))
        pages = {"": HOME_PAGE, "grades": GRADES_PAGE, "transkript": TRANSCRIPT_PAGE, "ejurnal": ATTENDANCE_PAGE}
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
        assert step.json()["notice"] == "Code sent to t...@mail.test"
        step = client.post("/api/sdu/portal/verify", json={"pending": step.json()["pending"], "code": "123456"})
        assert step.status_code == 200, step.text
    return step.json()


def test_portal_login_is_off_unless_enabled(monkeypatch):
    monkeypatch.delenv("ENABLE_PORTAL_LOGIN", raising=False)
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


def test_wrong_password_and_wrong_code_are_rejected(portal):
    bad = client.post("/api/sdu/portal/login", json={"student_id": "200000002", "password": "nope"})
    assert bad.status_code == 401 and bad.json()["detail"] == "Wrong password"
    step = client.post("/api/sdu/portal/login", json={"student_id": "200000002", "password": portal.password})
    wrong = client.post("/api/sdu/portal/verify", json={"pending": step.json()["pending"], "code": "000000"})
    assert wrong.status_code == 401
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
    assert _run(sdu_portal.fetch("schedule", conn["access_token"]))[0] == 404

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
