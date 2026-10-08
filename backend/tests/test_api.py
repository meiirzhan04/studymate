import secrets
import time
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def token(identifier="student@univ.edu", password="student123"):
    response = client.post("/api/auth/login", json={"identifier": identifier, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth(value): return {"Authorization": f"Bearer {value}"}


def test_invalid_login_is_generic():
    bad_id = f"test_{secrets.token_hex(4)}@univ.edu"
    response = client.post("/api/auth/login", json={"identifier": bad_id, "password": "wrongxx"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid identifier or password"


def test_student_dashboard_is_scoped_and_calculated():
    response = client.get("/api/student/dashboard", headers=auth(token("240103118", "studymate2026")))
    assert response.status_code == 200
    body = response.json()
    assert body["gpa"]["data_status"] == "available"
    assert all(row["student_id"] == "240103118" for row in body["courses"])


def test_student_cannot_open_teacher_area():
    assert client.get("/api/teacher/students", headers=auth(token("240103118", "studymate2026"))).status_code == 403


def test_teacher_scope_hides_unknown_student():
    teacher = token("teacher@univ.edu", "teacher123")
    assert client.get("/api/teacher/students/not-allowed", headers=auth(teacher)).status_code == 404


def test_teacher_analytics_explains_correlation():
    teacher = token("teacher@univ.edu", "teacher123")
    body = client.get("/api/teacher/analytics/attendance-performance", headers=auth(teacher)).json()
    assert len(body["points"]) >= 3
    assert "does not prove causation" in body["note"]


def test_sdu_student_240103120_login():
    t = token("240103120", "student123")
    res = client.get("/api/student/dashboard", headers=auth(t))
    assert res.status_code == 200
    body = res.json()
    assert all(row["student_id"] == "240103120" for row in body["courses"])


def test_direct_reset_password_endpoint_is_blocked():
    res = client.post("/api/auth/direct-reset", json={"email": "240103118", "new_password": "testNewPassword456"})
    assert res.status_code in (404, 405)


def test_teacher_intervention_flow():
    t = token("teacher@univ.edu", "teacher123")
    res = client.post(
        "/api/teacher/students/240103120/interventions",
        headers=auth(t),
        json={"action_type": "Tutoring Recommendation", "notes": "Please attend lab sessions on Wednesdays."}
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True

    # Check that interventions can be listed
    list_res = client.get("/api/teacher/students/240103120/interventions", headers=auth(t))
    assert list_res.status_code == 200
    items = list_res.json()["items"]
    assert any(i["action_type"] == "Tutoring Recommendation" for i in items)

    # Check student receives notification
    st = token("240103120", "student123")
    notifs = client.get("/api/student/notifications", headers=auth(st)).json()["items"]
    assert any("Academic Advisory" in n["title"] for n in notifs)


def test_user_self_registration_flow():
    # Register a new student with their own custom name and credentials
    unique_id = f"alikhan_{secrets.token_hex(4)}@gmail.com"
    reg_payload = {
        "name": "Alikhan Baizak",
        "identifier": unique_id,
        "password": "securepass2026",
        "role": "student"
    }
    reg_res = client.post("/api/auth/register", json=reg_payload)
    assert reg_res.status_code == 200
    data = reg_res.json()
    assert "access_token" in data
    assert data["user"]["name"] == "Alikhan Baizak"

    # Now verify login with the new credentials
    login_tok = token(unique_id, "securepass2026")
    assert login_tok is not None

    # Verify student dashboard loads with their courses
    dash = client.get("/api/student/dashboard", headers=auth(login_tok)).json()
    assert len(dash["courses"]) > 0


def test_public_registration_cannot_escalate_to_teacher():
    unique_id = f"imposter_{secrets.token_hex(4)}@univ.edu"
    res = client.post("/api/auth/register", json={
        "name": "Imposter User",
        "identifier": unique_id,
        "password": "securepassword123",
        "role": "teacher"
    })
    assert res.status_code == 200
    # Must be forced to student
    assert res.json()["user"]["role"] == "student"


def test_6_digit_code_reset_flow():
    from app.main import repo
    # Request 6-digit code for 240103118
    send_res = client.post("/api/auth/send-reset-code", json={"email": "240103118"})
    assert send_res.status_code == 200
    data = send_res.json()
    assert data["ok"] is True
    # The API should NOT leak _demo_code in the public response
    assert "_demo_code" not in data

    # Retrieve code from secure DB store as an authentic user would receive it via email
    with repo.connect() as db:
        row = db.execute("SELECT code FROM password_reset_codes WHERE email = '240103118' ORDER BY id DESC").fetchone()
        code = row["code"]
    assert code is not None and len(code) == 6

    # Verify and set new password
    verify_res = client.post("/api/auth/verify-reset-code", json={
        "email": "240103118",
        "code": code,
        "new_password": "brandNewSecret99"
    })
    assert verify_res.status_code == 200
    assert verify_res.json()["ok"] is True

    # Test login with new password
    t = token("240103118", "brandNewSecret99")
    assert t is not None

    # Reset back to studymate2026
    repo.direct_reset_password("240103118", "studymate2026")


def test_profile_name_update():
    t = token("240103118", "studymate2026")
    res = client.put("/api/me/profile", headers=auth(t), json={"name": "Meirzhan Updated"})
    assert res.status_code == 200
    assert res.json()["name"] == "Meirzhan Updated"


def test_reset_code_flow_user_118():
    from app.main import repo
    # 1. Request reset code
    res = client.post("/api/auth/send-reset-code", json={"email": "240103118"})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "_demo_code" not in data

    with repo.connect() as db:
        code = db.execute("SELECT code FROM password_reset_codes WHERE email = '240103118' ORDER BY id DESC").fetchone()["code"]

    # 2. Reset password using the code
    res_reset = client.post("/api/auth/verify-reset-code", json={
        "email": "240103118",
        "code": code,
        "new_password": "newpassword118"
    })
    assert res_reset.status_code == 200

    # 3. Authenticate with new password
    res_login = client.post("/api/auth/login", json={"identifier": "240103118", "password": "newpassword118"})
    assert res_login.status_code == 200

    # 4. Restore original password
    repo.direct_reset_password("240103118", "studymate2026")


def test_reset_code_flow_friend_188():
    from app.main import repo
    # 1. Request reset code for 240103188
    res = client.post("/api/auth/send-reset-code", json={"email": "240103188"})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "_demo_code" not in data

    with repo.connect() as db:
        code = db.execute("SELECT code FROM password_reset_codes WHERE email = '240103188' ORDER BY id DESC").fetchone()["code"]

    # 2. Reset password
    res_reset = client.post("/api/auth/verify-reset-code", json={
        "email": "240103188",
        "code": code,
        "new_password": "newpassword188"
    })
    assert res_reset.status_code == 200

    # 3. Authenticate with new password
    res_login = client.post("/api/auth/login", json={"identifier": "240103188", "password": "newpassword188"})
    assert res_login.status_code == 200

    # 4. Restore original password
    repo.direct_reset_password("240103188", "studymate2026")


# ─── SDU PLATFORM OAUTH VERIFICATION TESTS ───────────────────────────────────

def test_sdu_authorize_url_generation():
    res = client.post("/api/sdu/authorize-url", json={
        "redirect_uri": "http://localhost:5173/auth/sdu/callback"
    })
    assert res.status_code == 200
    data = res.json()
    assert "url" in data
    assert "state" in data
    assert "redirect_uri" in data
    url = data["url"]
    assert "https://api-sdu.javazhan.tech/oauth/authorize" in url
    assert "response_type=code" in url
    assert "code_challenge=" in url
    assert "code_challenge_method=S256" in url
    assert f"state={data['state']}" in url

    # Verify attempt is recorded in database
    from app.main import repo
    with repo.connect() as db:
        row = db.execute("SELECT * FROM sdu_oauth_attempts WHERE state = ?", (data["state"],)).fetchone()
        assert row is not None
        assert row["used"] == 0
        assert row["redirect_uri"] == "http://localhost:5173/auth/sdu/callback"


def test_sdu_successful_callback_and_data_sync(monkeypatch):
    import app.sdu_client as sdu_mod

    async def mock_exchange(code, code_verifier, redirect_uri, client=None):
        return {
            "access_token": "mock_sdu_token_123",
            "token_type": "Bearer",
            "expires_in": 2592000,
            "scope": "profile:read schedule:read grades-attendance:read"
        }

    async def mock_fetch(endpoint, access_token, params=None, client=None):
        if endpoint == "profile":
            return 200, {
                "student_id": "240999001",
                "fullname": "Aisulu Kairat",
                "email": "240999001@sdu.edu.kz"
            }
        elif endpoint == "attendance":
            # absence_percent is SDU course absence percentage, NOT attendance percentage
            return 200, {
                "source": "stored_sdu_data",
                "attendance": [
                    {"lesson": "Software Architecture", "year": 2026, "term": 1, "absence_percent": 8.0, "updated_at": "2026-10-01T08:00:00Z"},
                    {"lesson": "Computer Networks", "year": 2026, "term": 1, "absence_percent": 12.0, "updated_at": "2026-10-01T08:00:00Z"}
                ]
            }
        elif endpoint == "grades":
            return 200, {
                "source": "stored_sdu_data",
                "grades": [
                    {"lesson": "Software Architecture", "year": 2026, "term": 1, "grade": 92.0, "letter_grade": "A-", "credits": 3, "ects": 5, "updated_at": "2026-10-01T08:00:00Z"}
                ]
            }
        elif endpoint == "schedule":
            return 200, {
                "source": "stored_sdu_data",
                "schedule": [
                    {"course_code": "CSS 315", "course_name": "Software Architecture", "teacher": "Prof. Smith", "year": 2026, "term": 1}
                ]
            }
        return 404, {}

    monkeypatch.setattr(sdu_mod, "exchange_code_for_token", mock_exchange)
    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", mock_fetch)

    # 1. Start authorization
    start_res = client.post("/api/sdu/authorize-url", json={"redirect_uri": "http://localhost:5173/auth/sdu/callback"})
    state = start_res.json()["state"]

    # 2. Callback
    cb_res = client.post("/api/sdu/callback", json={
        "code": "valid_test_code",
        "state": state,
        "redirect_uri": "http://localhost:5173/auth/sdu/callback"
    })
    assert cb_res.status_code == 200
    cb_data = cb_res.json()
    assert cb_data["sdu_connected"] is True
    assert cb_data["user"]["student_id"] == "240999001"
    assert cb_data["user"]["name"] == "Aisulu Kairat"
    assert "access_token" in cb_data

    # 3. Verify student can access dashboard with the new token
    user_tok = cb_data["access_token"]
    dash_res = client.get("/api/student/dashboard", headers=auth(user_tok))
    assert dash_res.status_code == 200
    dash_data = dash_res.json()
    # Average absence = (8 + 12) / 2 = 10%, attendance = 90.0%
    assert dash_data["attendance"]["value"] == 90.0

    # 4. Check SDU status endpoint
    status_res = client.get("/api/sdu/status", headers=auth(user_tok))
    assert status_res.status_code == 200
    assert status_res.json()["connected"] is True


def test_sdu_callback_denial():
    start_res = client.post("/api/sdu/authorize-url", json={"redirect_uri": "http://localhost:5173/auth/sdu/callback"})
    state = start_res.json()["state"]

    # Simulate user clicked Cancel on SDU consent screen
    cb_res = client.post("/api/sdu/callback", json={
        "state": state,
        "error": "access_denied",
        "error_description": "User denied authorization"
    })
    assert cb_res.status_code == 400
    assert "denied" in cb_res.json()["detail"].lower()


def test_sdu_callback_wrong_or_missing_state():
    # Nonexistent state
    cb_res = client.post("/api/sdu/callback", json={
        "code": "test_code",
        "state": "nonexistent_state_value_123"
    })
    assert cb_res.status_code == 400
    assert "state" in cb_res.json()["detail"].lower()

    # Empty state
    cb_res_empty = client.post("/api/sdu/callback", json={
        "code": "test_code",
        "state": ""
    })
    assert cb_res_empty.status_code == 400


def test_sdu_callback_replayed_and_expired_attempt():
    from app.main import repo
    # 1. Test Replay attack
    start_res = client.post("/api/sdu/authorize-url", json={"redirect_uri": "http://localhost:5173/auth/sdu/callback"})
    state = start_res.json()["state"]

    # First consumption (simulate code missing to stop early after consumption)
    cb_first = client.post("/api/sdu/callback", json={"state": state})
    assert cb_first.status_code == 400
    assert "Missing authorization code" in cb_first.json()["detail"]

    # Second consumption with same state should be rejected as replayed
    cb_second = client.post("/api/sdu/callback", json={"code": "abc", "state": state})
    assert cb_second.status_code == 400
    assert "already been consumed" in cb_second.json()["detail"] or "replay" in cb_second.json()["detail"].lower()

    # 2. Test Expired attempt
    expired_state = f"expired_state_test_{secrets.token_hex(4)}"
    repo.create_sdu_oauth_attempt(expired_state, "verif123", "http://localhost:5173/auth/sdu/callback", None, expires_at=time.time() - 100)
    cb_exp = client.post("/api/sdu/callback", json={"code": "abc", "state": expired_state})
    assert cb_exp.status_code == 400
    assert "expired" in cb_exp.json()["detail"].lower()


def test_sdu_callback_wrong_pkce_verifier(monkeypatch):
    import app.sdu_client as sdu_mod

    async def mock_exchange_fail(code, code_verifier, redirect_uri, client=None):
        raise ValueError("Invalid PKCE code_verifier")

    monkeypatch.setattr(sdu_mod, "exchange_code_for_token", mock_exchange_fail)

    start_res = client.post("/api/sdu/authorize-url", json={"redirect_uri": "http://localhost:5173/auth/sdu/callback"})
    state = start_res.json()["state"]

    cb_res = client.post("/api/sdu/callback", json={
        "code": "invalid_pkce_code",
        "state": state
    })
    assert cb_res.status_code == 400
    assert "Failed to exchange code" in cb_res.json()["detail"]


def test_sdu_token_expiry_and_revocation(monkeypatch):
    import app.sdu_client as sdu_mod
    from app.main import repo

    # Create dummy user and save connection
    u = repo.create_user("Test Revoke Student", f"stu_rev_{secrets.token_hex(4)}", "password123")
    user_tok = token(u["student_id"], "password123")
    repo.save_sdu_connection(u["id"], "dummy_sdu_token_abc", time.time() + 3600, "profile:read")

    # Mock SDU returning 401 on sync
    async def mock_fetch_401(endpoint, access_token, params=None, client=None):
        return 401, {"detail": "Token expired or revoked"}

    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", mock_fetch_401)

    sync_res = client.post("/api/sdu/sync", headers=auth(user_tok))
    # 409, not 401: a revoked SDU token must not log the user out of StudyMate itself
    assert sync_res.status_code == 409
    assert "revoked or expired" in sync_res.json()["detail"].lower()

    # Verify connection was deleted locally
    conn = repo.get_sdu_connection(u["id"])
    assert conn is None

    # Test explicit disconnect endpoint
    repo.save_sdu_connection(u["id"], "dummy_sdu_token_def", time.time() + 3600, "profile:read")
    revoked_called = []

    async def mock_revoke(token_val, client=None):
        revoked_called.append(token_val)
        return True

    monkeypatch.setattr(sdu_mod, "revoke_token", mock_revoke)

    disc_res = client.post("/api/sdu/disconnect", headers=auth(user_tok))
    assert disc_res.status_code == 200
    assert disc_res.json()["ok"] is True
    assert "dummy_sdu_token_def" in revoked_called
    assert repo.get_sdu_connection(u["id"]) is None


def test_sdu_missing_scopes(monkeypatch):
    import app.sdu_client as sdu_mod
    from app.main import repo

    u = repo.create_user("Scope Test Student", f"stu_scope_{secrets.token_hex(4)}", "password123")
    user_tok = token(u["student_id"], "password123")
    repo.save_sdu_connection(u["id"], "dummy_sdu_token_xyz", time.time() + 3600, "profile:read")

    # Mock SDU returning 403 (missing scopes)
    async def mock_fetch_403(endpoint, access_token, params=None, client=None):
        return 403, {"detail": "Missing grades-attendance:read scope"}

    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", mock_fetch_403)

    sync_res = client.post("/api/sdu/sync", headers=auth(user_tok))
    assert sync_res.status_code == 403
    assert "scope" in sync_res.json()["detail"].lower() or "restricted" in sync_res.json()["detail"].lower()


def test_two_local_users_isolated_sdu_tokens():
    from app.main import repo

    u1 = repo.create_user("Isolated User 1", f"iso1_{secrets.token_hex(4)}", "password123")
    u2 = repo.create_user("Isolated User 2", f"iso2_{secrets.token_hex(4)}", "password123")

    tok1 = token(u1["student_id"], "password123")
    tok2 = token(u2["student_id"], "password123")

    token_a = f"token_secret_A_{secrets.token_hex(6)}"
    token_b = f"token_secret_B_{secrets.token_hex(6)}"

    repo.save_sdu_connection(u1["id"], token_a, time.time() + 3600, "profile:read")
    repo.save_sdu_connection(u2["id"], token_b, time.time() + 3600, "schedule:read")

    conn1 = repo.get_sdu_connection(u1["id"])
    conn2 = repo.get_sdu_connection(u2["id"])

    # Ensure token isolation
    assert conn1["access_token"] == token_a
    assert conn2["access_token"] == token_b
    assert conn1["access_token"] != conn2["access_token"]

    # When user 1 disconnects, user 2 must remain connected
    client.post("/api/sdu/disconnect", headers=auth(tok1))
    assert repo.get_sdu_connection(u1["id"]) is None
    assert repo.get_sdu_connection(u2["id"]) is not None
    assert repo.get_sdu_connection(u2["id"])["access_token"] == token_b


def test_sdu_live_endpoints_profile_schedule_transcript(monkeypatch):
    import app.sdu_client as sdu_mod
    from app.main import repo

    u = repo.create_user("Live Data Student", f"stu_live_{secrets.token_hex(4)}", "password123")
    user_tok = token(u["student_id"], "password123")
    repo.save_sdu_connection(u["id"], "dummy_live_token", time.time() + 3600, "profile:read schedule:read transcript:read")

    async def mock_fetch_live(endpoint, access_token, params=None, client=None):
        if endpoint == "profile":
            return 200, {
                "source": "live_sdu",
                "fetched_at": "2026-10-01T12:00:00Z",
                "student_id": "240103999",
                "fullname": "Live SDU Student",
                "email": "student@sdu.edu.kz"
            }
        elif endpoint == "schedule":
            return 200, {
                "source": "live_sdu",
                "fetched_at": "2026-10-01T12:00:00Z",
                "schedule": [
                    {"course_code": "INF 381", "course_name": "Project Management", "section": "01", "teacher": "Dr. Bek"}
                ]
            }
        elif endpoint == "transcript":
            return 200, {
                "source": "live_sdu",
                "fetched_at": "2026-10-01T12:00:00Z",
                "courses": [
                    {"course_code": "CSS 301", "course_name": "Algorithms", "grade": 91.5, "letter_grade": "A-", "credits": 4, "passed": True}
                ]
            }
        return 404, {}

    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", mock_fetch_live)

    # 1. Profile
    prof_res = client.get("/api/sdu/profile", headers=auth(user_tok))
    assert prof_res.status_code == 200
    assert prof_res.json()["source"] == "live_sdu"
    assert prof_res.json()["student_id"] == "240103999"

    # 2. Schedule
    sched_res = client.get("/api/sdu/schedule", headers=auth(user_tok))
    assert sched_res.status_code == 200
    assert sched_res.json()["source"] == "live_sdu"
    assert len(sched_res.json()["schedule"]) == 1

    # 3. Transcript
    trans_res = client.get("/api/sdu/transcript", headers=auth(user_tok))
    assert trans_res.status_code == 200
    assert trans_res.json()["source"] == "live_sdu"
    assert len(trans_res.json()["courses"]) == 1


def test_sdu_live_endpoints_error_handling_409_502_504(monkeypatch):
    import app.sdu_client as sdu_mod
    from app.main import repo

    u = repo.create_user("Error Student", f"stu_err_{secrets.token_hex(4)}", "password123")
    user_tok = token(u["student_id"], "password123")
    repo.save_sdu_connection(u["id"], "dummy_err_token", time.time() + 3600, "profile:read schedule:read transcript:read")

    # 1. Test 409 sdu_reconnect_required
    async def mock_fetch_409(endpoint, access_token, params=None, client=None):
        return 409, {"detail": {"code": "sdu_reconnect_required", "message": "SDU session expired, please re-authenticate"}}

    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", mock_fetch_409)
    res_409 = client.get("/api/sdu/schedule", headers=auth(user_tok))
    assert res_409.status_code == 409

    # 2. Test 502 upstream_unavailable
    async def mock_fetch_502(endpoint, access_token, params=None, client=None):
        return 502, {"detail": "upstream_unavailable"}

    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", mock_fetch_502)
    res_502 = client.get("/api/sdu/schedule", headers=auth(user_tok))
    assert res_502.status_code == 502

    # 3. Test 504 upstream_timeout
    async def mock_fetch_504(endpoint, access_token, params=None, client=None):
        return 504, {"detail": "upstream_timeout"}

    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", mock_fetch_504)
    res_504 = client.get("/api/sdu/schedule", headers=auth(user_tok))
    assert res_504.status_code == 504


def test_sdu_availability():
    res = client.get("/api/sdu/availability")
    assert res.status_code == 200
    data = res.json()
    assert "available" in data
    assert "origin" in data
    assert data["demo_fallback_supported"] is True


def test_sdu_demo_mode_flow():
    # 1. Unauthenticated demo connect creates/logs in demo student
    connect_res = client.post("/api/sdu/demo-connect")
    assert connect_res.status_code == 200
    conn_data = connect_res.json()
    assert conn_data["ok"] is True
    assert conn_data["demo_mode"] is True
    assert "access_token" in conn_data
    assert conn_data["sdu_connected"] is True
    demo_token = conn_data["access_token"]

    # 2. Check SDU status reports connected and demo_mode True
    status_res = client.get("/api/sdu/status", headers=auth(demo_token))
    assert status_res.status_code == 200
    st = status_res.json()
    assert st["connected"] is True
    assert st["demo_mode"] is True

    # 3. Live endpoints return rich mock data without hitting external server
    prof = client.get("/api/sdu/profile", headers=auth(demo_token)).json()
    assert prof["source"] == "demo_mock"
    assert prof["fullname"] == "Demo Student"

    sched = client.get("/api/sdu/schedule", headers=auth(demo_token)).json()
    assert sched["source"] == "demo_mock"
    assert len(sched["schedule"]) > 0

    trans = client.get("/api/sdu/transcript", headers=auth(demo_token)).json()
    assert trans["source"] == "demo_mock"
    assert len(trans["courses"]) == 15

    att = client.get("/api/sdu/attendance", headers=auth(demo_token)).json()
    assert att["source"] == "demo_mock"
    assert len(att["attendance"]) > 0

    grades = client.get("/api/sdu/grades", headers=auth(demo_token)).json()
    assert grades["source"] == "demo_mock"
    assert len(grades["grades"]) > 0

    # 4. Sync in demo mode succeeds
    sync_res = client.post("/api/sdu/sync", headers=auth(demo_token))
    assert sync_res.status_code == 200
    assert sync_res.json()["synced"] is True

    # 5. Disconnect in demo mode succeeds
    disc_res = client.post("/api/sdu/disconnect", headers=auth(demo_token))
    assert disc_res.status_code == 200
    assert disc_res.json()["ok"] is True

    status_after = client.get("/api/sdu/status", headers=auth(demo_token)).json()
    assert status_after["connected"] is False





def test_sdu_created_account_can_set_password_and_sign_in():
    session = client.post("/api/sdu/demo-connect", json={}).json()
    student_id = session["user"]["student_id"]
    new_password = f"pw-{secrets.token_hex(4)}"

    # The random password generated for SDU accounts is never known to the student.
    assert client.post("/api/auth/login", json={"identifier": student_id, "password": new_password}).status_code == 401

    response = client.post("/api/me/password", json={"new_password": new_password}, headers=auth(session["access_token"]))
    assert response.status_code == 200
    assert token(student_id, new_password)


def test_set_password_requires_auth_and_min_length():
    assert client.post("/api/me/password", json={"new_password": "abcdef"}).status_code == 401
    session = client.post("/api/sdu/demo-connect", json={}).json()
    response = client.post("/api/me/password", json={"new_password": "123"}, headers=auth(session["access_token"]))
    assert response.status_code == 422


def admin_token(monkeypatch):
    password = f"admin-{secrets.token_hex(6)}"
    monkeypatch.setenv("ADMIN_PASSWORD", password)
    response = client.post("/api/admin/login", json={"username": "admin", "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def test_admin_page_is_served():
    response = client.get("/admin")
    assert response.status_code == 200
    assert "StudyMate Admin" in response.text


def test_admin_login_disabled_without_env(monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    response = client.post("/api/admin/login", json={"username": "admin", "password": "anything"})
    assert response.status_code == 503


def test_admin_login_rejects_wrong_password(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", f"admin-{secrets.token_hex(6)}")
    response = client.post("/api/admin/login", json={"username": "admin", "password": "wrong-password"})
    assert response.status_code == 401


def test_admin_can_list_users_and_set_password(monkeypatch):
    admin = admin_token(monkeypatch)
    overview = client.get("/api/admin/overview", headers=auth(admin))
    assert overview.status_code == 200
    assert overview.json()["stats"]["users"] > 0

    student_id = client.post("/api/sdu/demo-connect", json={}).json()["user"]["student_id"]
    users = client.get("/api/admin/users", params={"q": student_id}, headers=auth(admin)).json()["items"]
    target = next(u for u in users if u["student_id"] == student_id)
    assert target["sdu"] == "demo"
    assert "sdu_token" not in target and "access_token" not in target

    new_password = f"pw-{secrets.token_hex(4)}"
    response = client.post(f"/api/admin/users/{target['id']}/password", json={"new_password": new_password}, headers=auth(admin))
    assert response.status_code == 200
    assert token(student_id, new_password)


def test_admin_and_user_tokens_are_not_interchangeable(monkeypatch):
    admin = admin_token(monkeypatch)
    student = token("240103118", "studymate2026")
    assert client.get("/api/admin/users", headers=auth(student)).status_code == 403
    assert client.get("/api/admin/users").status_code == 401
    assert client.get("/api/me", headers=auth(admin)).status_code == 401


def _notifications_for(student_id):
    from app.main import repo
    return repo.get_notifications(student_id)


def test_sdu_sync_notifies_only_about_real_changes():
    from app.main import repo

    u = repo.create_user("Notify Student", f"9{secrets.randbelow(10**8):08d}", "password123")
    sid = u["student_id"]
    profile = {"student_id": sid}
    grades = [{"lesson": "Databases", "grade": 80}, {"lesson": "Networks", "grade": 70}]
    attendance = [{"lesson": "Databases", "absence_percent": 5}, {"lesson": "Networks", "absence_percent": 10}]
    baseline = len(_notifications_for(sid))  # welcome message from registration

    # First sync is the baseline: no "new grade" spam
    repo.sync_sdu_student_data(u["id"], profile, None, grades, attendance)
    assert len(_notifications_for(sid)) == baseline

    # One grade changes, one course crosses the 20% absence limit, two new grades appear (one below 60%)
    grades2 = [{"lesson": "Databases", "grade": 85}, {"lesson": "Networks", "grade": 70},
               {"lesson": "Algorithms", "grade": 75}, {"lesson": "Security", "grade": 52}]
    attendance2 = [{"lesson": "Databases", "absence_percent": 5}, {"lesson": "Networks", "absence_percent": 21}]
    res = repo.sync_sdu_student_data(u["id"], profile, None, grades2, attendance2)
    assert res["new_notifications"] == 4
    new = _notifications_for(sid)[:4]
    titles = {n["title"] for n in new}
    assert titles == {"Grade updated", "New grade posted", "Low Grade Warning", "Absence limit exceeded"}
    assert any(n["type"] == "low_grade" and n["course"] == "Security" for n in new)

    # Identical sync creates nothing
    res = repo.sync_sdu_student_data(u["id"], profile, None, grades2, attendance2)
    assert res["new_notifications"] == 0


def test_password_only_student_gets_no_demo_data():
    ident = f"stu_real_{secrets.token_hex(4)}"
    reg = client.post("/api/auth/register", json={"name": "Real Student", "identifier": ident, "password": "password123"})
    assert reg.status_code == 200
    tok = token(ident, "password123")
    assert client.get("/api/sdu/status", headers=auth(tok)).json()["connected"] is False
    for path in ("/api/sdu/profile", "/api/sdu/schedule", "/api/sdu/transcript", "/api/sdu/attendance", "/api/sdu/grades"):
        response = client.get(path, headers=auth(tok))
        assert response.status_code == 404, path
        assert "demo_mock" not in response.text


def test_auto_sync_is_throttled():
    session = client.post("/api/sdu/demo-connect", json={}).json()
    headers = auth(session["access_token"])
    assert client.post("/api/sdu/sync", headers=headers).json()["synced"] is True
    assert client.post("/api/sdu/sync", params={"auto": "true"}, headers=headers).json()["skipped"] is True


def test_overall_attendance_alert_fires_once_below_75():
    from app.main import repo

    u = repo.create_user("Attendance Student", f"8{secrets.randbelow(10**8):08d}", "password123")
    sid = u["student_id"]
    ok = [{"lesson": "A", "absence_percent": 10}, {"lesson": "B", "absence_percent": 12}]
    low = [{"lesson": "A", "absence_percent": 26}, {"lesson": "B", "absence_percent": 26}]
    repo.sync_sdu_student_data(u["id"], {"student_id": sid}, None, None, ok)
    repo.sync_sdu_student_data(u["id"], {"student_id": sid}, None, None, low)
    alerts = [n for n in _notifications_for(sid) if n["title"] == "Attendance Alert"]
    assert len(alerts) == 1
    assert "fallen below the 75% requirement" in alerts[0]["detail"]

    repo.sync_sdu_student_data(u["id"], {"student_id": sid}, None, None, low)
    assert len([n for n in _notifications_for(sid) if n["title"] == "Attendance Alert"]) == 1


def _insights_student(scores):
    """Student with current-term courses built inside the test (no seeded fake data)."""
    import json as _json
    from app.main import repo

    u = repo.create_user("Insights Student", f"7{secrets.randbelow(10**8):08d}", "password123")
    sid = u["student_id"]
    with repo.connect() as db:
        db.execute("DELETE FROM assessment_items WHERE grade_id IN (SELECT id FROM grades WHERE student_id = ?)", (sid,))
        db.execute("DELETE FROM grades WHERE student_id = ?", (sid,))
        for course, comps in scores.items():
            db.execute(
                "INSERT INTO grades (student_id, semester, course, code, credits, components_json) VALUES (?, 'spring-2026', ?, ?, 5, ?)",
                (sid, course, course[:3].upper() + " 101", _json.dumps(comps)),
            )
        db.commit()
    return u, token(sid, "password123")


def test_insights_rank_weak_subjects_and_recalibrate():
    from app.main import repo

    u, tok = _insights_student({
        "Computer Science": [{"name": "Final", "score": 90, "weight": 1.0}],
        "Databases": [{"name": "Final", "score": 85, "weight": 1.0}],
        "Physics": [{"name": "Final", "score": 72, "weight": 1.0}],
        "Calculus": [{"name": "Midterm", "score": 70, "weight": 0.4}, {"name": "Integration quiz", "score": 45, "weight": 0.6}],
    })
    data = client.get("/api/student/insights", headers=auth(tok)).json()
    assert [r["course"] for r in data["ranked"]][0] == "Calculus"
    assert [w["course"] for w in data["weak_subjects"]] == ["Calculus"]
    assert data["weak_subjects"][0]["topic_gap"]["name"] == "Integration quiz"
    assert data["study_plan"]["total"] == 3

    # Retake improves the score to 82% → Calculus leaves the weak list
    import json as _json
    with repo.connect() as db:
        db.execute("UPDATE grades SET components_json = ? WHERE student_id = ? AND course = 'Calculus'",
                   (_json.dumps([{"name": "Final", "score": 82, "weight": 1.0}]), u["student_id"]))
        db.commit()
    data = client.get("/api/student/insights", headers=auth(tok)).json()
    assert data["weak_subjects"] == []


def test_study_tasks_persist_and_tutoring_reaches_teacher():
    from app.main import repo

    u, tok = _insights_student({"Physics": [{"name": "Final", "score": 50, "weight": 1.0}]})
    tasks = client.get("/api/student/insights", headers=auth(tok)).json()["study_plan"]["tasks"]
    assert client.post(f"/api/student/study-tasks/{tasks[0]['id']}", json={"done": True}, headers=auth(tok)).status_code == 200
    plan = client.get("/api/student/insights", headers=auth(tok)).json()["study_plan"]
    assert plan["done"] == 1 and plan["completion_rate"] == 33

    res = client.post("/api/student/tutoring", json={"course": "Physics", "preferred_time": "Thu 15:00", "note": "mechanics"}, headers=auth(tok))
    assert res.status_code == 200
    teacher = token("teacher@univ.edu", "teacher123")
    detail = client.get(f"/api/teacher/students/{u['student_id']}", headers=auth(teacher)).json()
    assert detail["tutoring_requests"][0]["course"] == "Physics"


def test_admin_deleted_accounts_stay_deleted_after_restart(tmp_path):
    from app.repository import SQLiteRepository

    path = str(tmp_path / "restart.db")
    repo1 = SQLiteRepository(path)
    assert repo1.admin_delete_user("u-240103120")
    assert "u-240103120" not in {u["id"] for u in SQLiteRepository(path).admin_list_users()}

    # Deleting every user must not crash the next start or bring the seed accounts back
    for u in repo1.admin_list_users():
        repo1.admin_delete_user(u["id"])
    assert SQLiteRepository(path).admin_list_users() == []


def _support_payload(**over):
    body = {"category": "bug", "subject": "Grades page error", "message": "The grades page shows an error after login."}
    body.update(over)
    return body


def test_support_ticket_requires_email_when_logged_out():
    res = client.post("/api/support/tickets", json=_support_payload(), headers={"X-Forwarded-For": f"10.0.{secrets.randbelow(250)}.1"})
    assert res.status_code == 422


def test_support_ticket_rate_limit():
    ip = f"10.9.{secrets.randbelow(250)}.{secrets.randbelow(250)}"
    email = f"spam_{secrets.token_hex(3)}@example.com"
    codes = [client.post("/api/support/tickets", json=_support_payload(email=email), headers={"X-Forwarded-For": ip}).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


def test_support_ticket_privacy_and_admin_only():
    a = client.post("/api/sdu/demo-connect", json={}).json()["access_token"]
    ident = f"stu_sup_{secrets.token_hex(3)}"
    client.post("/api/auth/register", json={"name": "Other Student", "identifier": ident, "password": "password123"})
    b = token(ident, "password123")

    ticket = client.post("/api/support/tickets", json=_support_payload(email="owner@example.com"), headers={**auth(a), "X-Forwarded-For": f"10.5.{secrets.randbelow(250)}.{secrets.randbelow(250)}"}).json()["ticket"]
    assert all(t["id"] != ticket["id"] for t in client.get("/api/support/tickets", headers=auth(b)).json()["items"])
    assert client.post(f"/api/support/tickets/{ticket['id']}/messages", json={"message": "hi"}, headers=auth(b)).status_code == 404
    assert client.get("/api/admin/support", headers=auth(a)).status_code == 403


def test_admin_reply_is_stored_emailed_and_notified(monkeypatch):
    import app.main as main_mod
    sent = []
    monkeypatch.setattr(main_mod, "send_email", lambda to, subject, text: (sent.append((to, subject, text)) or (True, "ok")))

    session = client.post("/api/sdu/demo-connect", json={}).json()
    st = session["access_token"]
    ticket = client.post("/api/support/tickets", json=_support_payload(email="student@example.com"), headers={**auth(st), "X-Forwarded-For": f"10.6.{secrets.randbelow(250)}.{secrets.randbelow(250)}"}).json()["ticket"]

    admin = admin_token(monkeypatch)
    res = client.post(f"/api/admin/support/{ticket['id']}/reply", json={"message": "Fixed, please refresh."}, headers=auth(admin)).json()
    assert res["emailed"] is True
    assert res["ticket"]["status"] == "answered"
    assert sent[0][0] == "student@example.com" and "Fixed, please refresh." in sent[0][2]
    titles = [n["title"] for n in client.get("/api/student/notifications", headers=auth(st)).json()["items"]]
    assert "Support replied" in titles

    # A user follow-up reopens the ticket
    mine = client.post(f"/api/support/tickets/{ticket['id']}/messages", json={"message": "Still broken"}, headers=auth(st)).json()["ticket"]
    assert mine["status"] == "open" and mine["messages"][-1]["author"] == "user"


def test_admin_reply_kept_when_email_fails(monkeypatch):
    import app.main as main_mod
    monkeypatch.setattr(main_mod, "send_email", lambda to, subject, text: (False, "SMTP credentials not configured"))
    ticket = client.post("/api/support/tickets", json=_support_payload(email=f"x_{secrets.token_hex(3)}@example.com"),
                         headers={"X-Forwarded-For": f"10.7.{secrets.randbelow(250)}.1"}).json()["ticket"]
    admin = admin_token(monkeypatch)
    res = client.post(f"/api/admin/support/{ticket['id']}/reply", json={"message": "We are on it"}, headers=auth(admin)).json()
    assert res["emailed"] is False
    last = res["ticket"]["messages"][-1]
    assert last["author"] == "admin" and last["emailed"] is False and "SMTP" in last["email_error"]


def _fresh_student():
    ident = f"9{secrets.randbelow(10**8):08d}"
    client.post("/api/auth/register", json={"name": "Reset Student", "identifier": ident, "password": "password123"})
    return ident


def test_reset_code_is_emailed_once_per_minute_and_reused(no_real_email):
    from app.main import repo
    ident = _fresh_student()

    first = client.post("/api/auth/send-reset-code", json={"email": ident}).json()
    second = client.post("/api/auth/send-reset-code", json={"email": ident}).json()
    assert first["resend_in"] == 60 and second["already_sent"] is True
    assert len([s for s in no_real_email if s[0] == "code"]) == 1

    # After the cooldown a resend repeats the same code, so every email matches
    with repo.connect() as db:
        db.execute("UPDATE password_reset_codes SET expires_at = expires_at - 120 WHERE email LIKE ?", (f"{ident}%",))
        db.commit()
    client.post("/api/auth/send-reset-code", json={"email": ident})
    codes = [s[2] for s in no_real_email if s[0] == "code"]
    assert len(codes) == 2 and codes[0] == codes[1]


def test_reset_is_step_by_step_and_limits_wrong_codes(no_real_email):
    ident = _fresh_student()
    client.post("/api/auth/send-reset-code", json={"email": ident})
    code = [s[2] for s in no_real_email if s[0] == "code"][-1]

    # Step 2 checks the code without using it up
    assert client.post("/api/auth/check-reset-code", json={"email": ident, "code": code}).status_code == 200
    # Step 3 sets the password with the same code
    res = client.post("/api/auth/verify-reset-code", json={"email": ident, "code": code, "new_password": "newpass789"})
    assert res.status_code == 200
    assert token(ident, "newpass789")

    # Wrong codes are limited
    other = _fresh_student()
    client.post("/api/auth/send-reset-code", json={"email": other})
    statuses = [client.post("/api/auth/check-reset-code", json={"email": other, "code": "000000"}).status_code for _ in range(6)]
    assert statuses[:5] == [400] * 5 and statuses[5] == 429


# ─── Sprint 3: deadlines (US-12/13), breakdown by name (US-10) ───────────────
def test_deadline_normalizer_accepts_common_moodle_shapes():
    from datetime import datetime, timezone
    from app import deadlines as dl
    soon = int(datetime.now(timezone.utc).timestamp()) + 86400

    a, err_a = dl.normalize({"deadlines": [{"id": 1, "title": "Lab", "course": "DB", "due": soon, "submitted": False}]})
    b, err_b = dl.normalize({"data": {"items": [{"name": "Essay", "coursename": "ENG", "duedate": soon * 1000, "status": "new"}]}})
    c, err_c = dl.normalize([{"activityname": "Quiz", "course": {"fullname": "Math"}, "timestart": datetime.fromtimestamp(soon, timezone.utc).isoformat()}])
    assert not err_a and not err_b and not err_c
    assert (a[0]["title"], a[0]["submitted"]) == ("Lab", False)
    assert (b[0]["course"], b[0]["submitted"]) == ("ENG", False)
    assert (c[0]["course"], c[0]["submitted"]) == ("Math", None)

    _, problem = dl.normalize({"unexpected": {"secret": "value"}})
    assert "unexpected" in problem and "value" not in problem


def test_moodle_errors_do_not_disconnect_sdu(monkeypatch):
    import app.sdu_client as sdu_mod
    from app.main import repo

    u = repo.create_user("Moodle Student", f"stu_md_{secrets.token_hex(4)}", "password123")
    tok = token(u["student_id"], "password123")
    repo.save_sdu_connection(u["id"], "live_token_md", time.time() + 3600, "profile:read moodle:read")

    async def moodle_401(endpoint, access_token, params=None, client=None):
        return 401, {"detail": "moodle not linked"}
    monkeypatch.setattr(sdu_mod, "fetch_sdu_data", moodle_401)

    res = client.get("/api/sdu/deadlines", headers=auth(tok)).json()
    assert res["available"] is False
    assert repo.get_sdu_connection(u["id"]) is not None

    # Without the moodle scope the API isn't even called
    repo.save_sdu_connection(u["id"], "live_token_md", time.time() + 3600, "profile:read")
    res = client.get("/api/sdu/deadlines", headers=auth(tok)).json()
    assert res["available"] is False and "Reconnect" in res["reason"]


def test_demo_deadlines_next_7_days_and_missed_alert_once():
    session = client.post("/api/sdu/demo-connect", json={}).json()
    headers = auth(session["access_token"])
    data = client.get("/api/sdu/deadlines", headers=headers).json()
    assert data["available"] is True
    due = [d["due_at"] for d in data["upcoming"]]
    assert due == sorted(due) and len(due) == 3          # 12-day item and the overdue ones are excluded
    assert [d["title"] for d in data["overdue"]] == ["Case study: TOGAF"]   # submitted quiz is not missed

    def missed_count():
        items = client.get("/api/student/notifications", headers=headers).json()["items"]
        return len([n for n in items if n["type"] == "missed_deadline" and "TOGAF" in n["detail"]])
    assert missed_count() == 1
    client.post("/api/sdu/sync", headers=headers)
    assert missed_count() == 1


def test_missed_alert_needs_explicit_unsubmitted_flag():
    from app.main import repo
    from datetime import datetime, timezone, timedelta
    u = repo.create_user("No Flag", f"6{secrets.randbelow(10**8):08d}", "password123")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    unknown = [{"id": "x", "title": "Lab", "course": "DB", "type": "assignment", "due_at": past, "submitted": None, "url": None}]
    res = repo.sync_sdu_student_data(u["id"], {"student_id": u["student_id"]}, None, None, None, deadlines=unknown)
    assert res["new_notifications"] == 0


def test_breakdown_lookup_by_course_name():
    tok = token("240103118", "studymate2026")
    res = client.get("/api/student/grades/breakdown", params={"course": "Fundamentals of Programming"}, headers=auth(tok))
    assert res.status_code == 200
    assert {c["name"] for c in res.json()["components"]} >= {"Midterm", "Final"}
    assert client.get("/api/student/grades/breakdown", params={"course": "No Such Course"}, headers=auth(tok)).status_code == 404


def test_sdu_short_message_reads_nested_errors():
    from app.main import sdu_short_message
    assert sdu_short_message({"detail": {"code": "moodle_not_linked", "message": "Link Moodle first"}}) == "Link Moodle first [moodle_not_linked]"
    assert sdu_short_message({"detail": "plain"}) == "plain"
    assert sdu_short_message({"detail": {"code": "x"}}) == "[x]"


def test_new_sdu_connection_resets_baseline():
    """Switching demo -> real SDU must not announce every existing grade as new."""
    from app.main import repo
    u = repo.create_user("Switch Student", f"5{secrets.randbelow(10**8):08d}", "password123")
    sid = u["student_id"]
    repo.sync_sdu_student_data(u["id"], {"student_id": sid}, None, [{"lesson": "Demo course", "grade": 80}], None)
    repo.save_sdu_connection(u["id"], "real_token", time.time() + 3600, "profile:read")
    real = [{"lesson": f"MDE {i}", "grade": 70 + i} for i in range(5)]
    res = repo.sync_sdu_student_data(u["id"], {"student_id": sid}, None, real, None)
    assert res["new_notifications"] == 0


def test_demo_mode_can_be_disabled(monkeypatch):
    from app.main import repo
    monkeypatch.setenv("ENABLE_DEMO_MODE", "0")
    assert client.post("/api/sdu/demo-connect", json={}).status_code == 404

    u = repo.create_user("Leftover Demo", f"stu_ld_{secrets.token_hex(4)}", "password123")
    tok = token(u["student_id"], "password123")
    from app import sdu_mock
    repo.save_sdu_connection(u["id"], sdu_mock.DEMO_ACCESS_TOKEN, time.time() + 3600, sdu_mock.DEMO_SCOPE)
    assert client.get("/api/sdu/status", headers=auth(tok)).json()["connected"] is False
    assert repo.get_sdu_connection(u["id"]) is None


def test_real_sync_uses_transcript_and_only_the_active_term():
    from app.main import repo, ACTIVE_TERM, student_insights, student_courses
    u = repo.create_user("Real Sync", f"4{secrets.randbelow(10**8):08d}", "password123")
    sid = u["student_id"]
    transcript = [
        {"semester": 1, "course_code": "MAT 101", "course_name": "Calculus", "grade_percent": 55, "letter_grade": "D+", "credits": 5, "passed": True},
        {"semester": 1, "course_code": "CSS 105", "course_name": "Programming", "grade_percent": 91, "letter_grade": "A-", "credits": 5, "passed": True},
        {"semester": 2, "course_code": "INF 451", "course_name": "Project Management", "grade_percent": None, "letter_grade": "IP", "credits": 5, "passed": False},
    ]
    grades = [
        {"lesson": "INF 451", "year": 2026, "term": 1, "grade": None},      # current term, not graded yet
        {"lesson": "MAT 101", "year": 2025, "term": 1, "grade": 55},        # older term: must not land in "this term"
    ]
    repo.sync_sdu_student_data(u["id"], {"student_id": sid}, None, grades, None,
                               transcript=transcript, active_term=ACTIVE_TERM, replace_local_grades=True)

    assert student_courses(sid, "spring-2026") == []        # nothing invented, older term skipped
    data = student_insights(sid, "spring-2026", u["id"])
    assert data["term_label"] == "Semester 1"
    assert [r["course"] for r in data["ranked"]] == ["Calculus", "Programming"]
    assert [w["course"] for w in data["weak_subjects"]] == ["Calculus"]


# ─── What-if planner ─────────────────────────────────────────────────────────
def whatif(tok, **body):
    return client.post("/api/student/grades/whatif", json=body, headers=auth(tok))


def test_whatif_uses_stored_breakdown_for_seeded_course():
    tok = token("240103118", "studymate2026")
    course = client.get("/api/student/grades?semester=spring-2026", headers=auth(tok)).json()["items"][0]
    comps = course["components"]
    target = comps[-1]
    others = sum(c["score"] * c["weight"] for c in comps[:-1])
    res = whatif(tok, course_code=course["code"], target_score=80, component_name=target["name"])
    assert res.status_code == 200
    assert res.json()["needed_score"] == max(0.0, round((80 - others) / target["weight"], 1))


def test_whatif_with_own_components_works_for_in_progress_sdu_course():
    from app.main import repo, ACTIVE_TERM
    u = repo.create_user("Whatif Real", f"4{secrets.randbelow(10**8):08d}", "password123")
    repo.sync_sdu_student_data(
        u["id"], {"student_id": u["student_id"]}, None,
        [{"lesson": "INF 451", "year": ACTIVE_TERM["year"], "term": ACTIVE_TERM["term"], "grade": None}], None,
        transcript=[{"semester": 5, "course_code": "INF 451", "course_name": "Project Management", "grade_percent": None, "letter_grade": "IP"}],
        active_term=ACTIVE_TERM, replace_local_grades=True)
    tok = token(u["student_id"], "password123")
    components = [
        {"name": "Midterm", "weight": 0.3, "score": 70},
        {"name": "Endterm", "weight": 0.3, "score": 80},
        {"name": "Final exam", "weight": 0.4, "score": None},
    ]
    res = whatif(tok, course_code="INF 451", target_score=75, component_name="Final exam", components=components)
    assert res.status_code == 200
    body = res.json()
    assert body["needed_score"] == 75.0          # (75 - 21 - 24) / 0.4
    assert body["feasible"] is True


def test_whatif_rejects_incomplete_or_inconsistent_components():
    tok = token("240103118", "studymate2026")
    base = {"course_code": "ANY 100", "target_score": 70, "component_name": "Final"}
    missing = whatif(tok, **base, components=[{"name": "Midterm", "weight": 0.5}, {"name": "Final", "weight": 0.5}])
    assert missing.status_code == 400 and "Midterm" in missing.json()["detail"]
    bad_sum = whatif(tok, **base, components=[{"name": "Midterm", "weight": 0.5, "score": 60}, {"name": "Final", "weight": 0.2}])
    assert bad_sum.status_code == 400 and "100%" in bad_sum.json()["detail"]
    dup = whatif(tok, **base, components=[{"name": "Final", "weight": 0.5, "score": 60}, {"name": "Final", "weight": 0.5}])
    assert dup.status_code == 400
    no_target = whatif(tok, **{**base, "component_name": "Quiz"}, components=[{"name": "Final", "weight": 1.0}])
    assert no_target.status_code == 404


def whatif_template(tok, code):
    return client.get("/api/student/grades/whatif/template", params={"course_code": code}, headers=auth(tok))


def fresh_student():
    from app.main import repo
    u = repo.create_user("Template User", f"4{secrets.randbelow(10**8):08d}", "password123")
    return token(u["student_id"], "password123")


def test_whatif_template_uses_syllabus_preset_for_known_course():
    tok = fresh_student()
    body = whatif_template(tok, "CSS 216").json()
    assert body["source"] == "syllabus"
    assert [(c["name"], c["weight"]) for c in body["components"]] == [
        ("Homework", 0.2), ("Quiz", 0.2), ("Midterm", 0.2), ("Final Exam", 0.2), ("Final Project", 0.2)]
    assert whatif_template(tok, "inf451").json()["source"] == "syllabus"     # code spacing/case ignored
    law = whatif_template(tok, "MDE 162").json()["components"]
    assert round(sum(c["weight"] for c in law), 3) == 1.0


def test_whatif_template_defaults_for_unknown_course():
    body = whatif_template(fresh_student(), "XYZ 999").json()
    assert body["source"] == "default"
    assert [c["weight"] for c in body["components"]] == [0.3, 0.3, 0.4]


def test_whatif_template_prefers_stored_breakdown_for_seeded_course():
    tok = token("240103118", "studymate2026")
    items = client.get("/api/student/grades?semester=spring-2026", headers=auth(tok)).json()["items"]
    code = next(i["code"] for i in items if len(i["components"]) > 1)
    body = whatif_template(tok, code).json()
    assert body["source"] == "grades"
    assert len(body["components"]) >= 2 and all(c["score"] is not None for c in body["components"])


def test_whatif_remembers_own_breakdown_per_user_and_course():
    tok, other = fresh_student(), fresh_student()
    comps = [{"name": "Labs", "weight": 0.5, "score": 90}, {"name": "Exam", "weight": 0.5, "score": None}]
    assert whatif(tok, course_code="MDE 162", target_score=80, component_name="Exam", components=comps).status_code == 200
    saved = whatif_template(tok, "MDE 162").json()
    assert saved["source"] == "saved"
    assert [(c["name"], c["weight"], c["score"]) for c in saved["components"]] == [("Labs", 0.5, 90.0), ("Exam", 0.5, None)]
    assert whatif_template(other, "MDE 162").json()["source"] == "syllabus"   # other students are unaffected


def test_whatif_does_not_save_rejected_breakdown():
    tok = fresh_student()
    bad = [{"name": "Labs", "weight": 0.5, "score": None}, {"name": "Exam", "weight": 0.5}]
    assert whatif(tok, course_code="CSS 216", target_score=80, component_name="Exam", components=bad).status_code == 400
    assert whatif_template(tok, "CSS 216").json()["source"] == "syllabus"


def test_synced_sdu_grades_are_weighted_by_ects_like_the_official_transcript():
    from app.main import repo, ACTIVE_TERM, student_courses
    u = repo.create_user("Ects User", f"4{secrets.randbelow(10**8):08d}", "password123")
    grades = [
        {"lesson": "CSS 105", "year": ACTIVE_TERM["year"], "term": ACTIVE_TERM["term"], "grade": 90, "credits": 3, "ects": 5},
        {"lesson": "MDE 283", "year": ACTIVE_TERM["year"], "term": ACTIVE_TERM["term"], "grade": 82, "credits": 3, "ects": 4},
    ]
    repo.sync_sdu_student_data(u["id"], {"student_id": u["student_id"]}, None, grades, None,
                               active_term=ACTIVE_TERM, replace_local_grades=True)
    assert sorted(c["credits"] for c in student_courses(u["student_id"], "spring-2026")) == [4, 5]
    dash = client.get("/api/student/dashboard", headers=auth(token(u["student_id"], "password123"))).json()
    assert dash["gpa"]["value"] == round((3.67 * 5 + 3.0 * 4) / 9, 2)   # A- and B, ECTS-weighted
