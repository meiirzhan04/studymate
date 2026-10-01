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


def test_direct_reset_password():
    res = client.post("/api/auth/direct-reset", json={"email": "240103118", "new_password": "testNewPassword456"})
    assert res.status_code == 200
    # verify login with new password
    t = token("240103118", "testNewPassword456")
    assert t is not None
    # reset back to studymate2026
    res2 = client.post("/api/auth/direct-reset", json={"email": "240103118", "new_password": "studymate2026"})
    assert res2.status_code == 200


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


def test_6_digit_code_reset_flow():
    # Request 6-digit code for 240103118
    send_res = client.post("/api/auth/send-reset-code", json={"email": "240103118"})
    assert send_res.status_code == 200
    data = send_res.json()
    assert data["ok"] is True
    code = data.get("_demo_code")
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
    client.post("/api/auth/direct-reset", json={"email": "240103118", "new_password": "studymate2026"})


def test_profile_name_update():
    t = token("240103118", "studymate2026")
    res = client.put("/api/me/profile", headers=auth(t), json={"name": "Meirzhan Updated"})
    assert res.status_code == 200
    assert res.json()["name"] == "Meirzhan Updated"

def test_reset_code_flow_user_118():
    # 1. Request reset code
    res = client.post("/api/auth/send-reset-code", json={"email": "240103118"})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "_demo_code" in data
    code = data["_demo_code"]

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
    client.post("/api/auth/send-reset-code", json={"email": "240103118"})
    from app.main import repo
    repo.reset_password_with_code("240103118", repo.connect().execute("SELECT code FROM password_reset_codes WHERE email = '240103118'").fetchone()["code"], "studymate2026")


def test_reset_code_flow_friend_188():
    # 1. Request reset code for 240103188
    res = client.post("/api/auth/send-reset-code", json={"email": "240103188"})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    code = data["_demo_code"]

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
    from app.main import repo
    from app.repository import hash_password
    salt = repo.connect().execute("SELECT password_salt FROM users WHERE student_id = '240103188'").fetchone()["password_salt"]
    h = hash_password("studymate2026", salt)
    with repo.connect() as db:
        db.execute("UPDATE users SET password_hash = ? WHERE student_id = '240103188'", (h,))
        db.commit()


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
    assert sync_res.status_code == 401
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


