"""E-mail for risk alerts via Resend (https://resend.com: free 3000 e-mails/month, 100/day).

    RESEND_API_KEY   API key from the Resend dashboard (enables sending)
    RESEND_FROM      sender, e.g. "StudyMate <alerts@yourdomain.com>"; default is Resend's shared test sender,
                     which can only deliver to the address that owns the Resend account
    RISK_ALERT_THRESHOLD   risk (0-1) from which an e-mail goes out, default 0.5
"""
from __future__ import annotations

import html
import os
import threading
import time

import httpx

RESEND_URL = "https://api.resend.com/emails"
DAILY_LIMIT = int(os.getenv("RESEND_DAILY_LIMIT", "100"))      # the free plan allows 100 e-mails a day
_lock = threading.Lock()
_day = {"key": "", "count": 0}


def configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY"))


def threshold() -> float:
    try:
        return float(os.getenv("RISK_ALERT_THRESHOLD", "0.5"))
    except ValueError:
        return 0.5


def _within_daily_limit() -> bool:
    today = time.strftime("%Y-%m-%d", time.gmtime())
    with _lock:
        if _day["key"] != today:
            _day.update(key=today, count=0)
        if _day["count"] >= DAILY_LIMIT:
            return False
        _day["count"] += 1
        return True


def send_resend(to_email: str, subject: str, text: str, html_body: str | None = None) -> tuple[bool, str]:
    """Returns (sent, reason). Never raises."""
    key = os.getenv("RESEND_API_KEY")
    if not key:
        return False, "RESEND_API_KEY is not set"
    if not _within_daily_limit():
        return False, "Resend daily limit reached"
    payload = {"from": os.getenv("RESEND_FROM", "StudyMate <onboarding@resend.dev>"), "to": [to_email],
               "subject": " ".join(subject.split())[:150], "text": text[:5000]}
    if html_body:
        payload["html"] = html_body
    try:
        resp = httpx.post(RESEND_URL, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=12)
    except httpx.HTTPError as exc:
        return False, f"Resend unreachable: {type(exc).__name__}"
    if resp.status_code in (200, 201):
        return True, "Sent via Resend"
    if resp.status_code == 403 and "testing emails" in resp.text.lower():
        return False, ("Resend's free test sender only delivers to the e-mail address of your Resend account. "
                       "Sign up to Resend with the same address, or verify your own domain and set RESEND_FROM.")
    return False, f"Resend error {resp.status_code}: {resp.text[:150]}"


def risk_email(name: str, result: dict, alerts: list[dict], for_curator: bool = False) -> tuple[str, str, str]:
    """(subject, text, html) for a high-risk alert."""
    who = name or "the student"
    pct = result["risk_percent"]
    reasons = [r["text"] for r in result["reasons"]]
    notable = [a for a in alerts if a["severity"] in ("critical", "high")][:3]
    subject = f"StudyMate: {who} is at {pct}% academic risk" if for_curator else f"StudyMate: your academic risk is {pct}%"
    intro = (f"{who} may need academic support. The risk model predicts {pct}% risk."
             if for_curator else f"Hi {who}, StudyMate predicts a {pct}% academic risk for you.")
    lines = [intro, "", "Main reasons:"] + [f"- {t}" for t in reasons]
    if notable:
        lines += ["", "Alerts:"] + [f"- {a['title']}: {a['detail']}" for a in notable]
    lines += ["", f"Predicted GPA: {result['predicted_gpa']:.1f}.",
              "Open the Monitoring tab in StudyMate to see how many classes you can safely skip." if not for_curator
              else "Please reach out to the student to plan support."]
    text = "\n".join(lines)
    items = "".join(f"<li>{html.escape(t)}</li>" for t in reasons)
    alert_items = "".join(f"<li><b>{html.escape(a['title'])}</b>: {html.escape(a['detail'])}</li>" for a in notable)
    body = (f"<p>{html.escape(intro)}</p><p><b>Main reasons</b></p><ul>{items}</ul>"
            + (f"<p><b>Alerts</b></p><ul>{alert_items}</ul>" if alert_items else "")
            + f"<p>Predicted GPA: <b>{result['predicted_gpa']:.1f}</b></p>")
    return subject, text, body
