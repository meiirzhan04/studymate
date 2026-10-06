import base64
import hashlib
import os
import secrets
from typing import Optional
import httpx

SDU_ORIGIN = os.getenv("SDU_ORIGIN", "https://api-sdu.javazhan.tech").rstrip("/")
SDU_CLIENT_ID = os.getenv("SDU_CLIENT_ID", "Lmx-fAIZYvwviEy_ruf4NQ")
DEFAULT_SCOPES = "profile:read profile:full academic-profile:read schedule:read grades-attendance:read courses:read transcript:read moodle:read"

ALLOWED_REDIRECT_URIS = [
    "http://localhost:5173/auth/sdu/callback",
    "http://localhost:3000/auth/sdu/callback",
    "http://localhost:8000/auth/sdu/callback",
    "http://127.0.0.1:5173/auth/sdu/callback",
    "http://127.0.0.1:3000/auth/sdu/callback",
    "http://127.0.0.1:8000/auth/sdu/callback",
    "https://studymate-mu-smoky.vercel.app/auth/sdu/callback",
    "https://studymate.vercel.app/auth/sdu/callback",
    "https://studymate-git-main-meiirzhans-projects.vercel.app/auth/sdu/callback",
    "https://studymate-knap.onrender.com/auth/sdu/callback",
]


def generate_pkce_pair() -> tuple[str, str, str]:
    """
    Generates (code_verifier, code_challenge, state)
    PKCE code_verifier is 43-128 URL-safe characters.
    code_challenge is BASE64URL(SHA256(code_verifier)) without padding.
    state is a cryptographically random 32-byte URL-safe string.
    """
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    state = secrets.token_urlsafe(32)
    return code_verifier, code_challenge, state


def get_authorize_url(
    redirect_uri: str,
    state: str,
    code_challenge: str,
    scope: Optional[str] = None
) -> str:
    from urllib.parse import urlencode

    query = {
        "response_type": "code",
        "client_id": SDU_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": scope or DEFAULT_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{SDU_ORIGIN}/oauth/authorize?{urlencode(query)}"


async def exchange_code_for_token(
    code: str,
    code_verifier: str,
    redirect_uri: str,
    client: Optional[httpx.AsyncClient] = None
) -> dict:
    """
    Exchanges authorization code for access_token via server-side POST
    Content-Type: application/x-www-form-urlencoded
    """
    url = f"{SDU_ORIGIN}/oauth/token"
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": SDU_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    }

    if client:
        resp = await client.post(url, data=data)
    else:
        async with httpx.AsyncClient(timeout=15.0) as default_client:
            resp = await default_client.post(url, data=data)

    if resp.status_code != 200:
        err_msg = f"Token exchange failed ({resp.status_code})"
        try:
            body = resp.json()
            if "error_description" in body:
                err_msg = body["error_description"]
            elif "error" in body:
                err_msg = body["error"]
            elif "detail" in body:
                err_msg = str(body["detail"])
        except Exception:
            err_msg = resp.text or err_msg
        raise ValueError(err_msg)

    return resp.json()


async def revoke_token(access_token: str, client: Optional[httpx.AsyncClient] = None) -> bool:
    """
    Revokes the access_token at SDU Platform via POST /oauth/revoke
    """
    url = f"{SDU_ORIGIN}/oauth/revoke"
    data = {"token": access_token}

    try:
        if client:
            resp = await client.post(url, data=data)
        else:
            async with httpx.AsyncClient(timeout=10.0) as default_client:
                resp = await default_client.post(url, data=data)
        return resp.status_code == 200
    except Exception:
        return False


_AVAILABILITY_CACHE: dict = {"checked_at": 0.0, "available": None}
_AVAILABILITY_TTL_SECONDS = 30.0


async def check_sdu_available(force: bool = False) -> bool:
    """
    Lightweight reachability probe for the SDU Platform.
    Any HTTP response (even 404) means the server is up; only network errors /
    timeouts count as unavailable. Cached for 30s so repeated clicks stay fast.
    """
    import time as _time

    now = _time.time()
    cached = _AVAILABILITY_CACHE["available"]
    if not force and cached is not None and now - _AVAILABILITY_CACHE["checked_at"] < _AVAILABILITY_TTL_SECONDS:
        return cached

    available = False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=4.0)) as probe:
            await probe.get(f"{SDU_ORIGIN}/", follow_redirects=False)
        available = True
    except Exception:
        available = False

    _AVAILABILITY_CACHE["available"] = available
    _AVAILABILITY_CACHE["checked_at"] = now
    return available


async def fetch_sdu_data(endpoint: str, access_token: str, params: Optional[dict] = None, client: Optional[httpx.AsyncClient] = None) -> tuple[int, dict]:
    """
    Live GET to SDU integration API endpoints with Authorization: Bearer <access_token>.
    Direct upstream fetch on each request under 90s budget.
    Returns (status_code, response_data).
    """
    url = f"{SDU_ORIGIN}/api/integrations/v1/{endpoint.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }

    try:
        if client:
            resp = await client.get(url, headers=headers, params=params)
        else:
            async with httpx.AsyncClient(timeout=30.0) as default_client:
                resp = await default_client.get(url, headers=headers, params=params)
        status = resp.status_code
        try:
            data = resp.json()
        except Exception:
            data = {"detail": "invalid_upstream_response", "raw": resp.text}
        return status, data
    except httpx.TimeoutException:
        return 504, {"detail": "upstream_timeout", "message": "SDU portal read timed out after 30 seconds."}
    except Exception as exc:
        return 502, {"detail": "upstream_unavailable", "message": f"SDU portal unavailable: {str(exc)}"}

