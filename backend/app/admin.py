"""Admin panel: JSON API under /api/admin and a single static page at /admin.

Credentials come only from env (nothing is stored in the repo):
  ADMIN_USERNAME  (default "admin")
  ADMIN_PASSWORD  (required; without it admin login is disabled)
"""
from __future__ import annotations

import base64
import hmac
import json
import logging
import os
import time
from collections import deque
from pathlib import Path
from typing import Annotated, Callable, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .repository import SQLiteRepository

logger = logging.getLogger("studymate.admin")

ADMIN_TOKEN_TTL = 8 * 3600

ADMIN_PAGE = Path(__file__).with_name("admin_page.html")

# Recent SDU integration failures, shown in the admin panel (in-memory, resets on restart).
_SDU_ERRORS: deque = deque(maxlen=100)

def record_sdu_error(stage: str, status: int | None, message: str, student_id: str | None = None) -> None:
    entry = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stage": stage,
        "status": status,
        "message": message[:500],
        "student_id": student_id,
    }
    _SDU_ERRORS.appendleft(entry)
    logger.warning("SDU error at %s (%s): %s", stage, status, message)

def admin_configured() -> bool:
    return bool(os.getenv("ADMIN_PASSWORD"))

def check_admin_password(username: str, password: str) -> bool:
    expected_password = os.getenv("ADMIN_PASSWORD")
    if not expected_password:
        return False
    username_ok = hmac.compare_digest(username.encode(), os.getenv("ADMIN_USERNAME", "admin").encode())
    password_ok = hmac.compare_digest(password.encode(), expected_password.encode())
    return username_ok and password_ok

def is_admin_payload(payload: dict) -> bool:
    return payload.get("typ") == "admin"

class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)

class AdminPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=200)

class AdminReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    close: bool = False


class AdminStatusRequest(BaseModel):
    status: Literal["open", "answered", "closed"]


def reply_email_text(ticket: dict, reply: str) -> str:
    first = next((m["body"] for m in ticket["messages"] if m["author"] == "user"), "")
    quoted = "\n".join("> " + line for line in first[:600].splitlines())
    hello = f"Hello {ticket['name']}," if ticket.get("name") else "Hello,"
    return (
        f"{hello}\n\n{reply}\n\n— StudyMate Support\n\n"
        f"Your request #{ticket['id']}: {ticket['subject']}\n{quoted}\n\n"
        "You can also see this conversation in StudyMate under Help & support."
    )


def create_admin_router(repo: SQLiteRepository, sign: Callable[[str], str], sdu_origin: str, sdu_client_id: str,
                        send_email: Callable[[str, str, str], tuple[bool, str]]) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    def issue_admin_token() -> str:
        raw = json.dumps({"sub": "admin", "typ": "admin", "exp": int(time.time()) + ADMIN_TOKEN_TTL}, separators=(",", ":"))
        body = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
        return f"{body}.{sign(body)}"

    def require_admin(authorization: Optional[str]) -> None:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Admin authentication required")
        try:
            body, signature = authorization[7:].rsplit(".", 1)
            if not hmac.compare_digest(signature, sign(body)):
                raise ValueError
            payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
            if payload["exp"] < time.time():
                raise ValueError
        except (ValueError, KeyError, json.JSONDecodeError):
            raise HTTPException(status_code=401, detail="Invalid or expired admin session")
        if not is_admin_payload(payload):
            raise HTTPException(status_code=403, detail="Admin access only")

    @router.get("/admin", response_class=HTMLResponse)
    def admin_page():
        return HTMLResponse(ADMIN_PAGE.read_text(encoding="utf-8"))

    @router.post("/api/admin/login")
    def admin_login(req: AdminLoginRequest):
        if not admin_configured():
            raise HTTPException(status_code=503, detail="Admin panel is disabled. Set the ADMIN_PASSWORD environment variable on the server.")
        key = f"admin:{req.username.strip().lower()}"
        if repo.check_brute_force(key):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
        if not check_admin_password(req.username.strip(), req.password):
            repo.record_attempt(key)
            raise HTTPException(status_code=401, detail="Invalid admin username or password")
        repo.clear_attempts(key)
        return {"access_token": issue_admin_token(), "expires_in": ADMIN_TOKEN_TTL}

    @router.get("/api/admin/overview")
    def admin_overview(authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        db_path = str(repo.path)
        return {
            "stats": repo.admin_stats(),
            "recent_sdu_errors": len(_SDU_ERRORS),
            "open_support_tickets": len(repo.list_support_tickets(status="open")),
            "system": {
                "database_path": db_path,
                "database_ephemeral": db_path.startswith("/tmp"),
                "sdu_origin": sdu_origin,
                "sdu_client_id": sdu_client_id,
                "admin_password_from_env": bool(os.getenv("ADMIN_PASSWORD")),
                "auth_secret_from_env": bool(os.getenv("AUTH_SECRET")),
                "mailer_secret_from_env": bool(os.getenv("MAILER_SECRET_KEY")),
            },
        }

    @router.get("/api/admin/users")
    def admin_users(q: str = "", authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        return {"items": repo.admin_list_users(q.strip())}

    @router.post("/api/admin/users/{user_id}/password")
    def admin_set_password(user_id: str, req: AdminPasswordRequest, authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        if not repo.set_password(user_id, req.new_password):
            raise HTTPException(status_code=404, detail="User not found")
        return {"ok": True}

    @router.delete("/api/admin/users/{user_id}")
    def admin_delete_user(user_id: str, authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        if not repo.admin_delete_user(user_id):
            raise HTTPException(status_code=404, detail="User not found")
        return {"ok": True}

    @router.get("/api/admin/sdu-connections")
    def admin_sdu_connections(authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        return {"items": repo.admin_list_sdu_connections()}

    @router.delete("/api/admin/sdu-connections/{user_id}")
    def admin_disconnect_sdu(user_id: str, authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        if not repo.delete_sdu_connection(user_id):
            raise HTTPException(status_code=404, detail="No SDU connection for this user")
        return {"ok": True}

    @router.get("/api/admin/sdu-errors")
    def admin_sdu_errors(authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        return {"items": list(_SDU_ERRORS)}

    @router.get("/api/admin/support")
    def admin_support_list(status: Optional[str] = None, authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        return {"items": repo.list_support_tickets(status=status or None)}

    @router.get("/api/admin/support/{ticket_id}")
    def admin_support_ticket(ticket_id: int, authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        ticket = repo.get_support_ticket(ticket_id)
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        return ticket

    @router.post("/api/admin/support/{ticket_id}/reply")
    def admin_support_reply(ticket_id: int, req: AdminReplyRequest, authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        ticket = repo.get_support_ticket(ticket_id)
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        body = req.message.strip()
        message_id = repo.add_support_message(ticket_id, "admin", body, status="closed" if req.close else "answered")
        # The reply is always visible in the app; email is a best-effort extra
        sent, reason = send_email(ticket["email"], f"Re: {ticket['subject']} [StudyMate #{ticket_id}]", reply_email_text(ticket, body))
        repo.set_support_message_email_result(message_id, sent, None if sent else reason)
        if ticket.get("user_id"):
            repo.notify_support_reply(ticket["user_id"], ticket["subject"])
        return {"ok": True, "emailed": sent, "email_detail": reason, "ticket": repo.get_support_ticket(ticket_id)}

    @router.post("/api/admin/support/{ticket_id}/status")
    def admin_support_status(ticket_id: int, req: AdminStatusRequest, authorization: Annotated[Optional[str], Header()] = None):
        require_admin(authorization)
        if not repo.set_support_status(ticket_id, req.status):
            raise HTTPException(status_code=404, detail="Ticket not found")
        return {"ok": True}

    return router
