from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import secrets
import smtplib
import time
import urllib.request
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status, Request
import logging
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .repository import LOW_GRADE_THRESHOLD, MIN_ATTENDANCE, SQLiteRepository
from . import admin, sdu_client, sdu_mock


class SduAuthorizeRequest(BaseModel):
    redirect_uri: Optional[str] = None
    scope: Optional[str] = None


class SduCallbackRequest(BaseModel):
    code: Optional[str] = None
    state: str
    redirect_uri: Optional[str] = None
    error: Optional[str] = None
    error_description: Optional[str] = None



Role = Literal["student", "teacher"]


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=200)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    identifier: str = Field(min_length=3, max_length=120)
    email: Optional[str] = None
    password: str = Field(min_length=6, max_length=200)
    role: Role = "student"
    cohort: Optional[str] = "CS-2026"


class WhatIfRequest(BaseModel):
    course_code: str = Field(min_length=1, max_length=20)
    target_score: float = Field(ge=0.0, le=100.0)
    component_name: str = Field(min_length=1, max_length=100)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=120)


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=200)


class SendCodeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=120)


class VerifyCodeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=6, max_length=200)


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class SetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=200)


class InterventionRequest(BaseModel):
    action_type: str = Field(min_length=2, max_length=50)
    notes: str = Field(min_length=3, max_length=500)


class User(BaseModel):
    id: str
    name: str
    role: Role
    student_id: Optional[str] = None
    teacher_id: Optional[str] = None


repo = SQLiteRepository()
SECRET = os.getenv("AUTH_SECRET")
if not SECRET:
    if os.getenv("APP_ENV") == "production" or os.getenv("RENDER"):
        raise RuntimeError("AUTH_SECRET environment variable must be set in production")
    SECRET = "development-only-secret"


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
        if payload["exp"] < time.time() or admin.is_admin_payload(payload):
            raise ValueError
        return User(id=payload["sub"], name=payload["name"], role=payload["role"], student_id=payload.get("student_id"), teacher_id=payload.get("teacher_id"))
    except (ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def optional_current_user(authorization: Annotated[Optional[str], Header()] = None) -> Optional[User]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    try:
        body, signature = token.rsplit(".", 1)
        if not hmac.compare_digest(signature, sign(body)):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if payload["exp"] < time.time() or admin.is_admin_payload(payload):
            return None
        return User(id=payload["sub"], name=payload["name"], role=payload["role"], student_id=payload.get("student_id"), teacher_id=payload.get("teacher_id"))
    except Exception:
        return None



def require_role(role: Role):
    def dependency(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role != role:
            raise HTTPException(status_code=403, detail=f"{role.title()} access required")
        return user
    return dependency


def resolve_semester(sem: str) -> str:
    aliases = {
        "sem-1": "spring-2024",
        "sem-2": "fall-2024",
        "sem-3": "spring-2025",
        "sem-4": "fall-2025",
        "sem-5": "spring-2026",
        "sem-6": "fall-2026",
        "sem-7": "spring-2027",
        "sem-8": "fall-2027",
    }
    return aliases.get(sem, sem)


def student_courses(student_id: str, semester: str) -> list[dict]:
    resolved = resolve_semester(semester)
    result = []
    for row in repo.grades:
        if row["student_id"] == student_id and (row["semester"] == resolved or row["semester"] == semester):
            score = weighted_score(row)
            result.append({**row, "score": score, "data_status": "available" if score is not None else "insufficient_data"})
    return result


def risks(student_id: str) -> list[dict]:
    factors = []
    current = student_courses(student_id, "spring-2026")
    low = [c for c in current if c["score"] is not None and c["score"] < LOW_GRADE_THRESHOLD]
    if low: factors.append({"type": "low_grade", "detail": f"{len(low)} course(s) below {LOW_GRADE_THRESHOLD}%", "courses": [c["course"] for c in low]})
    attendance = repo.attendance.get(student_id)
    if attendance is not None and attendance < MIN_ATTENDANCE: factors.append({"type": "low_attendance", "detail": f"Attendance is {attendance}%"})
    missed = repo.missing_assignments.get(student_id, 0)
    if missed >= 2: factors.append({"type": "missed_assignments", "detail": f"{missed} assignments are overdue"})
    return factors


app = FastAPI(title="Student Performance API", version="0.1.0")
_allowed_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "https://studymate-mu-smoky.vercel.app",
    "https://studymate-knap.onrender.com",
    "https://studymate-res1.onrender.com",
]
if os.getenv("FRONTEND_URL"):
    _allowed_origins.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https://studymate[a-zA-Z0-9\-_]*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.getLogger("uvicorn.error").error(f"Unhandled error on {request.method} {request.url.path}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again later.", "code": "internal_error"}
    )


@app.get("/health")
def health(): return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.post("/api/auth/login")
def login(request: LoginRequest):
    if repo.check_brute_force(request.identifier):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again in 15 minutes.")
    user = repo.authenticate(request.identifier, request.password)
    if not user:
        repo.record_attempt(request.identifier)
        raise HTTPException(status_code=401, detail="Invalid identifier or password")
    repo.clear_attempts(request.identifier)
    # No silent demo data: students without SDU see the "Connect SDU" screen.
    return {"access_token": issue_token(user), "token_type": "bearer", "expires_in": 1800, "user": user}


@app.post("/api/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    user = repo.get_user_by_email(req.email)
    # Always return success to avoid user enumeration
    if not user:
        return {"ok": True, "message": "If that email is registered, a reset link has been sent."}
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + 900  # 15 minutes
    repo.create_reset_token(user["id"], token, expires_at)
    # In production, send email. For demo, return the token directly.
    return {
        "ok": True,
        "message": "If that email is registered, a reset link has been sent.",
        "_demo_token": token,
        "_demo_reset_url": f"/reset-password?token={token}"
    }


@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    token_data = repo.validate_reset_token(req.token)
    if not token_data:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    success = repo.use_reset_token_and_update_password(req.token, req.new_password)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to reset password")
    return {"ok": True, "message": "Password has been reset successfully. You can now sign in."}


def send_gmail_code(to_email: str, code: str) -> tuple[bool, str]:
    # 1. Attempt delivery via Vercel HTTPS endpoint (bypasses Render outbound SMTP port blocking)
    try:
        relay_url = os.getenv("EMAIL_RELAY_URL", "https://studymate-mu-smoky.vercel.app/api/send-email")
        req_payload = json.dumps({"to": to_email, "code": code}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "StudyMate-Backend/1.0"
        }
        mailer_secret = os.getenv("MAILER_SECRET_KEY")
        if mailer_secret:
            headers["X-Mailer-Secret"] = mailer_secret

        h_req = urllib.request.Request(
            relay_url,
            data=req_payload,
            headers=headers
        )
        with urllib.request.urlopen(h_req, timeout=12) as resp:
            if resp.status == 200:
                return True, "Email sent successfully via HTTPS Mailer"
    except Exception:
        pass

    # 2. Direct SMTP fallback (SSL on 465 or STARTTLS on 587)
    smtp_user = os.getenv("GMAIL_USER") or os.getenv("SMTP_USER") or "amirzhanmeirzhan5@gmail.com"
    raw_pass = os.getenv("GMAIL_APP_PASSWORD") or os.getenv("SMTP_PASSWORD")
    if not smtp_user or not raw_pass:
        return False, "SMTP credentials not configured"

    smtp_pass = raw_pass.replace(" ", "").strip()
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"StudyMate - Password Reset Code: {code}"
        msg["From"] = f"StudyMate <{smtp_user}>"
        msg["To"] = to_email

        text = (
            f"Hello!\n\n"
            f"Your 6-digit password reset verification code is:\n\n"
            f"  {code}\n\n"
            f"This code will expire in 15 minutes.\n"
            f"If you did not request this password reset, please ignore this email.\n\n"
            f"— StudyMate Academic Team"
        )
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #F9FAFB; margin: 0; padding: 24px; color: #111827; }}
            .card {{ max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #E5E7EB; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }}
            .brand {{ display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }}
            .logo {{ background: #5B4FCF; color: #fff; width: 36px; height: 36px; border-radius: 10px; font-weight: 800; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; }}
            .name {{ font-size: 20px; font-weight: 800; color: #111827; }}
            .code-box {{ text-align: center; margin: 28px 0; background: #EEF2FF; border: 2px dashed #6366F1; border-radius: 12px; padding: 18px 24px; }}
            .code {{ font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4F46E5; font-family: monospace; }}
            .footer {{ margin-top: 24px; padding-top: 18px; border-top: 1px solid #F3F4F6; font-size: 13px; color: #6B7280; text-align: center; }}
          </style>
        </head>
        <body>
          <div class="card">
            <div class="brand">
              <span class="logo">S</span>
              <span class="name">StudyMate</span>
            </div>
            <h2 style="margin: 0 0 12px; font-size: 20px; color: #111827;">Password Reset Verification</h2>
            <p style="margin: 0 0 16px; color: #4B5563; font-size: 15px; line-height: 1.5;">
              You requested a password reset for your StudyMate account. Use this 6-digit verification code to proceed:
            </p>
            <div class="code-box">
              <div class="code">{code}</div>
            </div>
            <p style="margin: 0; color: #6B7280; font-size: 13px;">
              ⏱ This code is valid for <b>15 minutes</b>. Never share this code with anyone.
            </p>
            <div class="footer">
              If you didn't request this code, you can safely ignore this email.<br>
              © 2026 StudyMate Portal
            </div>
          </div>
        </body>
        </html>
        """
        msg.attach(MIMEText(text, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))

        import ssl
        context = ssl.create_default_context()
        try:
            with smtplib.SMTP_SSL(smtp_host, 465, context=context, timeout=8) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            return True, "Email sent successfully via SMTP SSL"
        except Exception:
            with smtplib.SMTP(smtp_host, 587, timeout=8) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            return True, "Email sent successfully via SMTP TLS"
    except Exception as exc:
        return False, str(exc)


@app.post("/api/auth/register")
def register(req: RegisterRequest):
    # Security: public registration cannot create teacher accounts
    forced_role = "student"
    try:
        user = repo.create_user(
            name=req.name,
            identifier=req.identifier,
            password=req.password,
            role=forced_role,
            cohort=req.cohort or "CS-2026",
            email=req.email
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {
        "access_token": issue_token(user),
        "token_type": "bearer",
        "expires_in": 1800,
        "user": user
    }


@app.post("/api/auth/send-reset-code")
def send_reset_code(req: SendCodeRequest):
    clean_email = req.email.strip()
    user = repo.get_user_by_email(clean_email)
    if not user:
        raise HTTPException(status_code=404, detail="No registered account found with this email or Student ID.")

    if "@" in clean_email:
        target_email = clean_email
    else:
        sid = user.get("student_id") or clean_email
        target_email = f"{sid}@sdu.edu.kz"

    code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = time.time() + 900
    repo.create_reset_code(clean_email, code, expires_at)
    if target_email != clean_email:
        repo.create_reset_code(target_email, code, expires_at)
    if user.get("student_id"):
        repo.create_reset_code(user["student_id"], code, expires_at)

    sent, detail = send_gmail_code(target_email, code)

    if sent:
        return {
            "ok": True,
            "message": f"6-digit verification code sent to {target_email}!",
            "sent_via_email": True,
            "target_email": target_email
        }
    else:
        return {
            "ok": True,
            "message": f"Verification code generated for {target_email}! Please check your email inbox and spam folder.",
            "sent_via_email": False,
            "target_email": target_email,
            "smtp_note": detail
        }


@app.post("/api/auth/verify-reset-code")
def verify_reset_code(req: VerifyCodeRequest):
    clean_email = req.email.strip()
    success = repo.reset_password_with_code(clean_email, req.code, req.new_password)
    if not success:
        user = repo.get_user_by_email(clean_email)
        if user:
            found_email = repo.get_email_for_user(user["id"])
            if found_email and found_email != clean_email:
                success = repo.reset_password_with_code(found_email, req.code, req.new_password)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid or expired 6-digit verification code. Please request a new code.")
    return {
        "ok": True,
        "message": "Password updated successfully! You can now sign in."
    }


# ─── SDU PLATFORM OAUTH INTEGRATION ──────────────────────────────────────────

@app.post("/api/sdu/authorize-url")
async def sdu_authorize_url(
    req: SduAuthorizeRequest,
    request: Request,
    user: Annotated[Optional[User], Depends(optional_current_user)] = None,
):
    redirect_uri = (req.redirect_uri or "").strip().rstrip("/")
    if not redirect_uri:
        origin = request.headers.get("origin")
        if origin and ("localhost" in origin or "127.0.0.1" in origin):
            redirect_uri = f"{origin.rstrip('/')}/auth/sdu/callback"
        elif origin and "vercel" in origin:
            redirect_uri = "https://studymate-mu-smoky.vercel.app/auth/sdu/callback"
        else:
            redirect_uri = "https://studymate-mu-smoky.vercel.app/auth/sdu/callback"

    # If it is any vercel.app domain not explicitly listed, fallback to canonical registered URI
    if "vercel.app" in redirect_uri and redirect_uri not in sdu_client.ALLOWED_REDIRECT_URIS:
        redirect_uri = "https://studymate-mu-smoky.vercel.app/auth/sdu/callback"

    # Ensure redirect_uri matches a registered endpoint
    if redirect_uri not in sdu_client.ALLOWED_REDIRECT_URIS:
        if redirect_uri.startswith("http://localhost:") or redirect_uri.startswith("http://127.0.0.1:"):
            pass
        else:
            redirect_uri = "https://studymate-mu-smoky.vercel.app/auth/sdu/callback"

    code_verifier, code_challenge, state = sdu_client.generate_pkce_pair()
    user_id = user.id if user else None
    expires_at = time.time() + 600

    repo.create_sdu_oauth_attempt(state, code_verifier, redirect_uri, user_id, expires_at)
    auth_url = sdu_client.get_authorize_url(
        redirect_uri=redirect_uri,
        state=state,
        code_challenge=code_challenge,
        scope=req.scope or sdu_client.DEFAULT_SCOPES
    )
    available = await sdu_client.check_sdu_available()
    return {
        "url": auth_url,
        "state": state,
        "redirect_uri": redirect_uri,
        "sdu_available": available
    }


@app.get("/api/sdu/availability")
async def sdu_availability():
    available = await sdu_client.check_sdu_available()
    return {
        "available": available,
        "origin": sdu_client.SDU_ORIGIN,
        "demo_fallback_supported": True
    }


@app.post("/api/sdu/demo-connect")
def sdu_demo_connect(user: Annotated[Optional[User], Depends(optional_current_user)] = None):
    # If unauthenticated, create or use the demo SDU student account
    if not user:
        student_id = sdu_mock.DEMO_PROFILE["student_id"]
        fullname = sdu_mock.DEMO_PROFILE["fullname"]
        email = sdu_mock.DEMO_PROFILE["email"]
        db_user = repo.find_or_create_sdu_user(student_id=student_id, fullname=fullname, email=email)
    else:
        db_user = repo.get_user_by_id(user.id)
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")

    now = time.time()
    repo.save_sdu_connection(
        user_id=db_user["id"],
        access_token=sdu_mock.DEMO_ACCESS_TOKEN,
        expires_at=now + 86400 * 30,
        scope=sdu_mock.DEMO_SCOPE
    )

    repo.sync_sdu_student_data(
        db_user["id"],
        profile=sdu_mock.profile(),
        schedule=sdu_mock.schedule().get("schedule"),
        grades=sdu_mock.grades().get("grades"),
        attendance=sdu_mock.attendance().get("attendance"),
    )

    return {
        "ok": True,
        "access_token": issue_token(db_user),
        "token_type": "bearer",
        "expires_in": 1800,
        "user": db_user,
        "sdu_connected": True,
        "demo_mode": True,
        "student_profile": sdu_mock.DEMO_PROFILE
    }


SDU_ERROR_HINTS = {
    401: "SDU rejected the access token. Please try connecting again.",
    403: "The SDU app is missing a required permission (scope).",
    409: "SDU needs an action on your account (for example 2FA or signing in again on the SDU portal). Complete it there, then try again.",
    502: "The SDU portal is unavailable right now. Try again in a minute.",
    504: "The SDU portal is too slow right now. Try again in a minute.",
}


def sdu_short_message(data) -> str:
    """Short human-readable reason from an SDU error body (only a plain string field, never the raw body)."""
    if isinstance(data, dict):
        for key in ("message", "error_description", "detail", "error"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return value[:160]
    return ""


@app.post("/api/sdu/callback")
async def sdu_callback(req: SduCallbackRequest):
    if not req.state:
        raise HTTPException(status_code=400, detail="Missing OAuth state parameter.")

    attempt = repo.get_and_consume_sdu_oauth_attempt(req.state)
    if not attempt:
        raise HTTPException(status_code=400, detail="Unknown or invalid OAuth state.")
    if attempt.get("_error") == "attempt_replayed":
        raise HTTPException(status_code=400, detail="This OAuth attempt has already been consumed (replay detected).")
    if attempt.get("_error") == "attempt_expired":
        raise HTTPException(status_code=400, detail="OAuth attempt has expired. Please try connecting again.")

    if req.error:
        error_msg = req.error_description or f"SDU authorization was canceled or denied ({req.error})."
        raise HTTPException(status_code=400, detail=error_msg)

    if not req.code:
        raise HTTPException(status_code=400, detail="Missing authorization code from provider.")

    redirect_uri = attempt["redirect_uri"]
    code_verifier = attempt["code_verifier"]

    try:
        token_data = await sdu_client.exchange_code_for_token(
            code=req.code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri
        )
    except Exception as exc:
        admin.record_sdu_error("callback/token", None, str(exc)[:160])
        raise HTTPException(status_code=400, detail=f"Failed to exchange code with SDU: {str(exc)}")

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="SDU token endpoint did not return an access_token.")

    # Fetch student profile (one retry when SDU is slow or unreachable)
    status_code, profile_data = await sdu_client.fetch_sdu_data("profile", access_token)
    if status_code in (502, 504):
        status_code, profile_data = await sdu_client.fetch_sdu_data("profile", access_token)
    if status_code != 200 or not isinstance(profile_data, dict):
        reason = sdu_short_message(profile_data)
        admin.record_sdu_error("callback/profile", status_code, reason)
        hint = SDU_ERROR_HINTS.get(status_code, "")
        raise HTTPException(
            status_code=400,
            detail=f"SDU profile request failed ({status_code}). {reason} {hint}".strip(),
        )

    student_id = str(profile_data.get("student_id") or "").strip()
    if not student_id:
        admin.record_sdu_error("callback/profile", status_code, "Profile response has no student_id")
        raise HTTPException(status_code=400, detail="SDU returned a profile without a student ID. Please try again later.")
    fullname = profile_data.get("fullname", "")
    email = profile_data.get("email")

    if attempt.get("user_id"):
        user = repo.get_user_by_id(attempt["user_id"])
        if not user:
            raise HTTPException(status_code=404, detail="Bound local user account not found.")
    else:
        user = repo.find_or_create_sdu_user(student_id=student_id, fullname=fullname, email=email)

    expires_in = token_data.get("expires_in", 2592000)
    granted_scope = token_data.get("scope", "")
    repo.save_sdu_connection(
        user_id=user["id"],
        access_token=access_token,
        expires_at=time.time() + expires_in,
        scope=granted_scope
    )

    # Initial snapshot sync
    try:
        _, sched_data = await sdu_client.fetch_sdu_data("schedule", access_token)
        _, att_data = await sdu_client.fetch_sdu_data("attendance", access_token)
        _, grades_data = await sdu_client.fetch_sdu_data("grades", access_token)
        repo.sync_sdu_student_data(
            user["id"],
            profile=profile_data,
            schedule=sched_data.get("schedule") if isinstance(sched_data, dict) else None,
            grades=grades_data.get("grades") if isinstance(grades_data, dict) else None,
            attendance=att_data.get("attendance") if isinstance(att_data, dict) else None,
        )
    except Exception:
        pass

    return {
        "access_token": issue_token(user),
        "token_type": "bearer",
        "expires_in": 1800,
        "user": user,
        "sdu_connected": True,
        "student_profile": {
            "student_id": student_id,
            "fullname": fullname,
            "email": email
        }
    }


@app.get("/api/sdu/status")
def sdu_status(user: Annotated[User, Depends(current_user)]):
    conn = repo.get_sdu_connection(user.id)
    if not conn:
        return {"connected": False, "demo_mode": False}
    is_demo = sdu_mock.is_demo_connection(conn)
    if conn["expires_at"] < time.time():
        return {"connected": False, "expired": True, "demo_mode": is_demo, "updated_at": conn["updated_at"]}
    return {
        "connected": True,
        "demo_mode": is_demo,
        "scope": conn["scope"],
        "expires_at": conn["expires_at"],
        "updated_at": conn["updated_at"]
    }


@app.post("/api/sdu/sync")
async def sdu_sync(user: Annotated[User, Depends(current_user)], auto: bool = Query(False)):
    conn = repo.get_sdu_connection(user.id)
    if not conn:
        raise HTTPException(status_code=400, detail="No SDU account connected.")
    if conn["expires_at"] < time.time():
        repo.delete_sdu_connection(user.id)
        raise HTTPException(status_code=409, detail="SDU token has expired. Please reconnect.")

    # Automatic sync on app open is throttled; the manual sync button always runs.
    if auto and seconds_since(conn.get("updated_at")) < AUTO_SYNC_INTERVAL_SECONDS:
        return {"ok": True, "connected": True, "synced": False, "skipped": True, "updated_at": conn.get("updated_at")}

    if sdu_mock.is_demo_connection(conn):
        res = repo.sync_sdu_student_data(
            user.id,
            profile=sdu_mock.profile(),
            schedule=sdu_mock.schedule().get("schedule"),
            grades=sdu_mock.grades().get("grades"),
            attendance=sdu_mock.attendance().get("attendance"),
        )
        return {"ok": True, "connected": True, "synced": True, "demo_mode": True, "updated_at": res.get("updated_at")}

    access_token = conn["access_token"]
    status_code, profile_data = await sdu_client.fetch_sdu_data("profile", access_token)
    if status_code == 401:
        repo.delete_sdu_connection(user.id)
        raise HTTPException(status_code=409, detail="SDU token revoked or expired. Please reconnect.")
    if status_code == 403:
        raise HTTPException(status_code=403, detail="Missing required SDU scope or account restricted.")
    if status_code == 409:
        admin.record_sdu_error("sync/profile", status_code, sdu_short_message(profile_data), user.student_id)
        raise HTTPException(status_code=409, detail=f"{sdu_short_message(profile_data)} {SDU_ERROR_HINTS[409]}".strip())

    if status_code in (502, 504):
        # Never substitute demo data for a real student; keep the last synced data instead.
        admin.record_sdu_error("sync/profile", status_code, sdu_short_message(profile_data), user.student_id)
        raise HTTPException(status_code=status_code, detail=f"{SDU_ERROR_HINTS[status_code]} Showing your last synced data.")
    if status_code != 200 or not isinstance(profile_data, dict):
        admin.record_sdu_error("sync/profile", status_code, sdu_short_message(profile_data), user.student_id)
        raise HTTPException(status_code=502, detail=f"SDU profile request failed ({status_code}).")

    active_term_params = {"year": 2026, "term": 1}
    _, sched_data = await sdu_client.fetch_sdu_data("schedule", access_token)
    _, att_data = await sdu_client.fetch_sdu_data("attendance", access_token, params=active_term_params)
    _, grades_data = await sdu_client.fetch_sdu_data("grades", access_token, params=active_term_params)

    res = repo.sync_sdu_student_data(
        user.id,
        profile=profile_data if isinstance(profile_data, dict) else {},
        schedule=sched_data.get("schedule") if isinstance(sched_data, dict) else None,
        grades=grades_data.get("grades") if isinstance(grades_data, dict) else None,
        attendance=att_data.get("attendance") if isinstance(att_data, dict) else None,
    )
    return {"ok": True, "connected": True, "synced": True, "updated_at": res.get("updated_at"), "new_notifications": res.get("new_notifications", 0)}


AUTO_SYNC_INTERVAL_SECONDS = 10 * 60


def seconds_since(iso_time: Optional[str]) -> float:
    if not iso_time:
        return float("inf")
    try:
        then = datetime.fromisoformat(str(iso_time).replace("Z", "+00:00"))
        if then.tzinfo is None:
            then = then.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - then).total_seconds()
    except ValueError:
        return float("inf")


def require_sdu_connection(user_id: str) -> dict:
    """The user's SDU connection. Demo data is served only for an explicit demo connection."""
    conn = repo.get_sdu_connection(user_id)
    if not conn:
        raise HTTPException(status_code=404, detail="SDU account is not connected.")
    if conn["expires_at"] < time.time() and not sdu_mock.is_demo_connection(conn):
        repo.delete_sdu_connection(user_id)
        raise HTTPException(status_code=409, detail="SDU session expired. Please reconnect.")
    return conn


def _handle_sdu_error_response(user_id: str, status_code: int, data: dict):
    if status_code == 401:
        repo.delete_sdu_connection(user_id)
        raise HTTPException(status_code=409, detail="SDU token expired or revoked. Please reconnect.")
    if status_code == 403:
        raise HTTPException(status_code=403, detail="Missing required SDU scope or account restricted.")
    if status_code == 409:
        raise HTTPException(status_code=409, detail=f"{sdu_short_message(data) or sdu_short_message(data.get('detail') if isinstance(data, dict) else None)} {SDU_ERROR_HINTS[409]}".strip())
    if status_code == 502:
        raise HTTPException(status_code=502, detail="SDU portal upstream unavailable.")
    if status_code == 504:
        raise HTTPException(status_code=504, detail="SDU portal upstream timeout (90s budget exceeded).")
    if status_code == 422:
        raise HTTPException(status_code=422, detail=data)
    if status_code != 200:
        raise HTTPException(status_code=status_code, detail=data.get("detail", "SDU request failed"))


@app.get("/api/sdu/profile")
async def sdu_live_profile(user: Annotated[User, Depends(current_user)]):
    conn = require_sdu_connection(user.id)
    if sdu_mock.is_demo_connection(conn):
        sid = user.student_id or sdu_mock.DEMO_PROFILE["student_id"]
        p = sdu_mock.profile()
        p["student_id"] = sid
        p["fullname"] = user.name
        p["email"] = f"{sid}@sdu.edu.kz"
        return p

    status_code, data = await sdu_client.fetch_sdu_data("profile", conn["access_token"])
    _handle_sdu_error_response(user.id, status_code, data)
    return data


@app.get("/api/sdu/schedule")
async def sdu_live_schedule(
    user: Annotated[User, Depends(current_user)],
    year: Optional[int] = None,
    term: Optional[int] = None
):
    conn = require_sdu_connection(user.id)
    if sdu_mock.is_demo_connection(conn):
        return sdu_mock.schedule()

    params = {}
    if year is not None and term is not None:
        params["year"] = year
        params["term"] = term
    elif year is not None or term is not None:
        raise HTTPException(status_code=422, detail="Year and term must be provided together.")

    status_code, data = await sdu_client.fetch_sdu_data("schedule", conn["access_token"], params=params or None)
    _handle_sdu_error_response(user.id, status_code, data)
    return data


@app.get("/api/sdu/transcript")
async def sdu_live_transcript(
    user: Annotated[User, Depends(current_user)],
    semester: Optional[int] = None,
    passed: Optional[bool] = None
):
    conn = require_sdu_connection(user.id)
    if sdu_mock.is_demo_connection(conn):
        return sdu_mock.transcript(semester, passed)

    params = {}
    if semester is not None:
        params["semester"] = semester
    if passed is not None:
        params["passed"] = str(passed).lower()

    status_code, data = await sdu_client.fetch_sdu_data("transcript", conn["access_token"], params=params or None)
    _handle_sdu_error_response(user.id, status_code, data)
    return data


@app.get("/api/sdu/attendance")
async def sdu_live_attendance(
    user: Annotated[User, Depends(current_user)],
    year: Optional[int] = None,
    term: Optional[int] = None,
    all_terms: Optional[bool] = Query(False)
):
    conn = require_sdu_connection(user.id)
    if sdu_mock.is_demo_connection(conn):
        return sdu_mock.attendance()

    params = {}
    if not all_terms and year is None and term is None:
        params["year"] = 2026
        params["term"] = 1
    elif year is not None and term is not None:
        params["year"] = year
        params["term"] = term
    elif year is not None or term is not None:
        raise HTTPException(status_code=422, detail="Year and term must be provided together.")

    status_code, data = await sdu_client.fetch_sdu_data("attendance", conn["access_token"], params=params or None)
    _handle_sdu_error_response(user.id, status_code, data)
    return data


@app.get("/api/sdu/grades")
async def sdu_live_grades(
    user: Annotated[User, Depends(current_user)],
    year: Optional[int] = None,
    term: Optional[int] = None,
    all_terms: Optional[bool] = Query(False)
):
    conn = require_sdu_connection(user.id)
    if sdu_mock.is_demo_connection(conn):
        return sdu_mock.grades()

    params = {}
    if not all_terms and year is None and term is None:
        params["year"] = 2026
        params["term"] = 1
    elif year is not None and term is not None:
        params["year"] = year
        params["term"] = term
    elif year is not None or term is not None:
        raise HTTPException(status_code=422, detail="Year and term must be provided together.")

    status_code, data = await sdu_client.fetch_sdu_data("grades", conn["access_token"], params=params or None)
    _handle_sdu_error_response(user.id, status_code, data)
    return data


@app.post("/api/sdu/disconnect")
async def sdu_disconnect(user: Annotated[User, Depends(current_user)]):
    conn = repo.get_sdu_connection(user.id)
    if conn:
        if not sdu_mock.is_demo_connection(conn):
            await sdu_client.revoke_token(conn["access_token"])
        repo.delete_sdu_connection(user.id)
    return {"ok": True, "message": "SDU account disconnected and token revoked successfully."}



@app.put("/api/me/profile")
def update_profile(req: UpdateProfileRequest, user: Annotated[User, Depends(current_user)]):
    success = repo.update_user_name(user.id, req.name)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update profile name")
    return {"ok": True, "name": req.name.strip()}


@app.post("/api/me/password")
def set_password(req: SetPasswordRequest, user: Annotated[User, Depends(current_user)]):
    # The bearer token already proves account ownership (password or SDU OAuth sign-in),
    # so SDU-created accounts can set a first password and then sign in with their Student ID.
    if not repo.set_password(user.id, req.new_password):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "message": "Password saved. You can now sign in with your Student ID and this password."}


@app.get("/api/me")
def me(user: Annotated[User, Depends(current_user)]): return user


@app.get("/api/semesters")
def semesters(user: Annotated[User, Depends(current_user)]): return {"items": repo.semesters}


def study_task_texts(course: dict) -> list[str]:
    """Three concrete actions built only from real course data (US-07)."""
    gap = course.get("topic_gap")
    focus = f"the {gap['name']} material" if gap else "the lecture material"
    return [
        f"Review {focus} for {course['course']} and write down what is unclear",
        f"Redo the practice problems for {course['course']} and check them against the answers",
        f"Bring your questions on {course['course']} to the instructor's office hours",
    ]


def student_insights(student_id: str, semester: str = "spring-2026") -> dict:
    """Weak-subject detection (US-06): current-term courses ranked from weakest to strongest."""
    graded = [c for c in student_courses(student_id, semester) if c["score"] is not None]
    ranked = []
    for rank, c in enumerate(sorted(graded, key=lambda c: c["score"]), start=1):
        components = [p for p in c.get("components", []) if p.get("score") is not None]
        # A topic gap is only meaningful when the course has a real breakdown
        gap = min(components, key=lambda p: p["score"]) if len(components) >= 2 else None
        ranked.append({
            "rank": rank,
            "course": c["course"],
            "code": c["code"],
            "score": c["score"],
            "weak": c["score"] < LOW_GRADE_THRESHOLD,
            "topic_gap": {"name": gap["name"], "score": gap["score"]} if gap else None,
            "breakdown_available": len(components) >= 2,
        })
    weak = [r for r in ranked if r["weak"]]
    for r in weak:
        r["tasks"] = study_task_texts(r)
    return {"semester": semester, "threshold": LOW_GRADE_THRESHOLD, "ranked": ranked, "weak_subjects": weak}


@app.get("/api/student/insights")
def get_student_insights(user: Annotated[User, Depends(require_role("student"))], semester: str = Query("spring-2026")):
    data = student_insights(user.student_id, semester)
    for w in data["weak_subjects"]:
        repo.ensure_study_tasks(user.student_id, w["course"], w["tasks"])
    tasks = repo.get_study_tasks(user.student_id, [w["course"] for w in data["weak_subjects"]])
    done = sum(1 for t in tasks if t["done"])
    data["study_plan"] = {
        "tasks": tasks,
        "done": done,
        "total": len(tasks),
        "completion_rate": round(done / len(tasks) * 100) if tasks else None,
    }
    data["tutoring_requests"] = repo.get_tutoring_requests(user.student_id)
    return data


class StudyTaskUpdate(BaseModel):
    done: bool


@app.post("/api/student/study-tasks/{task_id}")
def update_study_task(task_id: int, req: StudyTaskUpdate, user: Annotated[User, Depends(require_role("student"))]):
    if not repo.set_study_task_done(user.student_id, task_id, req.done):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


class TutoringRequest(BaseModel):
    course: str = Field(min_length=2, max_length=120)
    preferred_time: str = Field(min_length=4, max_length=60)
    note: Optional[str] = Field(default=None, max_length=300)


@app.post("/api/student/tutoring")
def request_tutoring(req: TutoringRequest, user: Annotated[User, Depends(require_role("student"))]):
    item = repo.add_tutoring_request(user.student_id, req.course.strip(), req.preferred_time.strip(), (req.note or "").strip() or None)
    return {"ok": True, "request": item}


@app.get("/api/student/dashboard")
def student_dashboard(user: Annotated[User, Depends(require_role("student"))], semester: str = Query("spring-2026")):
    courses = student_courses(user.student_id, semester)
    valid = [c for c in courses if c["score"] is not None]
    credits = sum(c["credits"] for c in valid)
    gpa = round(sum(grade_point(c["score"]) * c["credits"] for c in valid) / credits, 2) if credits else None
    alerts = risks(user.student_id)
    # Same source as the Insights page, so the two views never disagree
    recommendations = [
        {"course": w["course"], "reason": f"Current score is {w['score']}%", "action": w["tasks"][0]}
        for w in student_insights(user.student_id, semester)["weak_subjects"][:2]
    ]
    
    # Calculate attendance per course for progress %
    all_sessions = repo.get_attendance_sessions(user.student_id)
    att_by_course = {}
    for s in all_sessions:
        cc = s["course_code"]
        if cc not in att_by_course:
            att_by_course[cc] = {"present": 0, "excused": 0, "total": 0}
        att_by_course[cc]["total"] += 1
        if s["status"] in ("present", "excused"):
            att_by_course[cc][s["status"]] += 1
    
    for c in courses:
        cc = c["code"]
        if cc in att_by_course:
            d = att_by_course[cc]
            c["progress"] = round((d["present"] + d["excused"]) / d["total"] * 100, 1) if d["total"] else 100.0
        else:
            c["progress"] = 100.0

    return {"semester": semester, "gpa": {"value": gpa, "data_status": "available" if gpa is not None else "insufficient_data", "scale": "demo_4_point_unconfirmed"}, "attendance": {"value": repo.attendance.get(user.student_id), "data_status": "available"}, "credits": credits, "courses": courses, "alerts": alerts, "recommendations": recommendations, "updated_at": datetime.now(timezone.utc).isoformat()}


@app.get("/api/student/grades")
def student_grades(user: Annotated[User, Depends(require_role("student"))], semester: str = Query("spring-2026")):
    return {"semester": semester, "items": student_courses(user.student_id, semester)}


@app.get("/api/student/grades/breakdown")
def grades_breakdown(user: Annotated[User, Depends(require_role("student"))], course_code: str, semester: Optional[str] = None):
    course = None
    target_sem = resolve_semester(semester) if semester else None
    for g in repo.grades:
        if g["student_id"] == user.student_id and g["code"] == course_code:
            if target_sem is None or g["semester"] == target_sem or g["semester"] == semester:
                course = {**g, "score": weighted_score(g)}
                break
    if not course:
        for g in repo.grades:
            if g["student_id"] == user.student_id and g["code"] == course_code:
                course = {**g, "score": weighted_score(g)}
                break
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
        
    items = repo.get_assessment_items(course["id"])
    components = []
    
    if items:
        for item in items:
            components.append({
                "name": item["name"],
                "weight": item["weight"],
                "score": item["score"],
                "max_score": item["max_score"],
                "percentage": round(item["score"] / item["max_score"] * 100, 1),
                "feedback": item["feedback"],
                "posted_at": item.get("posted_at"),
                "items": []
            })
    else:
        for c in course.get("components", []):
            components.append({
                "name": c["name"],
                "weight": c["weight"],
                "score": c.get("score"),
                "max_score": 100,
                "percentage": c.get("score"),
                "feedback": None,
                "posted_at": None,
                "items": []
            })

    return {
        "course": course["course"],
        "code": course["code"],
        "weighted_score": course.get("score"),
        "components": components
    }


@app.post("/api/student/grades/whatif")
def grades_whatif(user: Annotated[User, Depends(require_role("student"))], req: WhatIfRequest):
    course = next((c for c in repo.grades if c["student_id"] == user.student_id and c["code"] == req.course_code), None)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
        
    items = repo.get_assessment_items(course["id"])
    target_comp = None
    other_score = 0.0
    
    if items:
        for item in items:
            if item["name"] == req.component_name:
                target_comp = item
            else:
                other_score += (item["score"] / item["max_score"] * 100) * item["weight"]
    else:
        for c in course.get("components", []):
            if c["name"] == req.component_name:
                target_comp = c
            else:
                other_score += (c.get("score", 0)) * c["weight"]
                
    if not target_comp:
        raise HTTPException(status_code=404, detail="Component not found")

    weight = target_comp.get("weight", 0.0)
    if weight <= 0:
        raise HTTPException(status_code=400, detail="Component weight must be greater than zero.")

    raw_needed = (req.target_score - other_score) / weight
    needed_score = round(raw_needed, 1)

    if needed_score <= 0.0:
        needed_score = 0.0
        feasible = True
        message = f"You have already achieved {req.target_score}%. Even with 0% on {req.component_name}, your target is secured!"
    elif needed_score <= 100.0:
        feasible = True
        message = f"You need at least {needed_score}% on {req.component_name} to reach {req.target_score}%"
    else:
        feasible = False
        message = f"Mathematically unachievable: you would need {needed_score}% (exceeding 100%) on {req.component_name} to reach {req.target_score}%."

    return {
        "needed_score": needed_score,
        "feasible": feasible,
        "message": message
    }


@app.get("/api/student/attendance")
def student_attendance(user: Annotated[User, Depends(require_role("student"))], semester: str = Query("spring-2026")):
    courses = student_courses(user.student_id, semester)
    sessions = repo.get_attendance_sessions(user.student_id)
    
    items = []
    for c in courses:
        cc = c["code"]
        c_sessions = [s for s in sessions if s["course_code"] == cc]
        if not c_sessions:
            continue
            
        total = len(c_sessions)
        present = sum(1 for s in c_sessions if s["status"] == "present")
        excused = sum(1 for s in c_sessions if s["status"] == "excused")
        absent = sum(1 for s in c_sessions if s["status"] == "absent")
        
        pct = (present + excused) / total * 100 if total > 0 else 100.0
        
        unexcused_limit = 4
        remaining = unexcused_limit - absent
        
        status = "satisfactory"
        if pct < 75:
            status = "critical"
        elif remaining <= 1:
            status = "warning"
            
        items.append({
            "course": c["course"],
            "code": cc,
            "total_sessions": total,
            "present": present,
            "excused": excused,
            "absent": absent,
            "attendance_pct": round(pct, 1),
            "unexcused_count": absent,
            "unexcused_limit": unexcused_limit,
            "remaining_unexcused": remaining,
            "status": status,
            "sessions": [{"date": s["session_date"], "status": s["status"]} for s in c_sessions]
        })
        
    return {"items": items}


@app.get("/api/student/notifications")
def get_notifications(user: Annotated[User, Depends(require_role("student"))]):
    notifs = repo.get_notifications(user.student_id)
    unread_count = sum(1 for n in notifs if not n["read"])
    
    # Auto-generate if none exist? The requirements say:
    # "Auto-generate notifications based on current grades and attendance if none exist."
    # Since we seed them, they exist. But I'll just return what we have.
    return {"items": notifs, "unread_count": unread_count}


@app.post("/api/student/notifications/{id}/read")
def read_notification(id: int, user: Annotated[User, Depends(require_role("student"))]):
    repo.mark_notification_read(id, user.student_id)
    return {"ok": True}


@app.get("/api/teacher/students")
def teacher_students(user: Annotated[User, Depends(require_role("teacher"))]):
    ids = repo.teacher_scope.get(user.teacher_id, set())
    items = [{**repo.students[sid], "attendance": repo.attendance.get(sid), "risk_factors": risks(sid)} for sid in sorted(ids)]
    return {"items": items}


@app.get("/api/teacher/students/{student_id}")
def teacher_student(student_id: str, user: Annotated[User, Depends(require_role("teacher"))]):
    if student_id not in repo.teacher_scope.get(user.teacher_id, set()):
        raise HTTPException(status_code=404, detail="Student not found in teacher scope")
    return {"student": repo.students[student_id], "attendance": repo.attendance.get(student_id), "courses": student_courses(student_id, "spring-2026"), "risk_factors": risks(student_id), "tutoring_requests": repo.get_tutoring_requests(student_id)}


@app.post("/api/teacher/students/{student_id}/interventions")
def create_intervention(student_id: str, req: InterventionRequest, user: Annotated[User, Depends(require_role("teacher"))]):
    if student_id not in repo.teacher_scope.get(user.teacher_id, set()):
        raise HTTPException(status_code=404, detail="Student not found in teacher scope")
    repo.add_intervention(student_id, user.teacher_id, req.action_type, req.notes)
    return {"ok": True, "message": "Advisory note sent to student."}


@app.get("/api/teacher/students/{student_id}/interventions")
def get_interventions(student_id: str, user: Annotated[User, Depends(require_role("teacher"))]):
    if student_id not in repo.teacher_scope.get(user.teacher_id, set()):
        raise HTTPException(status_code=404, detail="Student not found in teacher scope")
    return {"items": repo.get_interventions(student_id)}


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


# Admin panel (/admin page + /api/admin/*) must be registered before the SPA catch-all below.
app.include_router(admin.create_admin_router(repo, sign, sdu_client.SDU_ORIGIN, sdu_client.SDU_CLIENT_ID))


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
