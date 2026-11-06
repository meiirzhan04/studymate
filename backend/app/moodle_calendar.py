"""Moodle browser login and the student's live action deadlines."""
from __future__ import annotations

import re
import time
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup

from . import deadlines

ORIGIN = "https://moodle.sdu.edu.kz"
HOST = "moodle.sdu.edu.kz"
TIMEOUT = httpx.Timeout(20, connect=8)
SESSION_COOKIE = "MoodleSession"
SESSKEY = re.compile(r'"sesskey"\s*:\s*"([A-Za-z0-9]+)"')


class MoodleError(Exception):
    pass


def _on_moodle(url: str) -> bool:
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.hostname == HOST and parsed.port is None


def _session_key(html: str) -> str | None:
    match = SESSKEY.search(html)
    if match:
        return match.group(1)
    field = BeautifulSoup(html, "html.parser").select_one('input[name="sesskey"]')
    return field.get("value") if field else None


async def _dashboard(client: httpx.AsyncClient) -> str:
    response = await client.get(f"{ORIGIN}/my/")
    if not _on_moodle(str(response.url)) or "/login/" in response.url.path or response.status_code != 200:
        raise MoodleError("Moodle session expired. Reconnect your account.")
    sesskey = _session_key(response.text)
    if not sesskey:
        raise MoodleError("Moodle did not provide a session key. Reconnect your account.")
    return sesskey


def _normalise(events: list[dict]) -> list[dict]:
    mapped = []
    for event in events:
        if not isinstance(event, dict):
            continue
        action = event.get("action") if isinstance(event.get("action"), dict) else {}
        url = action.get("url") or event.get("viewurl")
        mapped.append({"id": event.get("id"), "name": event.get("name"),
                       "course": event.get("course"), "due_at": event.get("timesort") or event.get("timestart"),
                       "type": event.get("modulename") or "assignment",
                       "submitted": False, "url": url if isinstance(url, str) and _on_moodle(url) else None})
    items, problem = deadlines.normalize({"events": mapped})
    if problem:
        raise MoodleError("Moodle returned deadlines in an unexpected format.")
    return items


async def _deadlines(client: httpx.AsyncClient, sesskey: str) -> list[dict]:
    now = int(time.time())
    items = []
    after = 0
    for _ in range(5):
        request = [{"index": 0, "methodname": "core_calendar_get_action_events_by_timesort",
                    "args": {"timesortfrom": now, "timesortto": now + 60 * 86400,
                             "aftereventid": after, "limitnum": 50}}]
        response = await client.post(f"{ORIGIN}/lib/ajax/service.php",
                                     params={"sesskey": sesskey, "info": "core_calendar_get_action_events_by_timesort"},
                                     json=request)
        if response.status_code != 200 or not _on_moodle(str(response.url)):
            raise MoodleError("Could not load Moodle deadlines right now.")
        try:
            result = response.json()[0]
            if result.get("error"):
                raise MoodleError("Could not load Moodle deadlines. Reconnect your account.")
            data = result["data"]
            page = data["events"]
            if not isinstance(page, list):
                raise ValueError("invalid events")
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            raise MoodleError("Moodle returned deadlines in an unexpected format.") from exc
        items.extend(page)
        last = data.get("lastid")
        if len(page) < 50 or not last or last == after:
            break
        after = int(last)
    return _normalise(items)


async def login(username: str, password: str) -> tuple[dict, list[dict]]:
    """Use the password once; persist only Moodle's encrypted session cookie."""
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        page = await client.get(f"{ORIGIN}/login/index.php")
        if page.status_code != 200 or not _on_moodle(str(page.url)):
            raise MoodleError("Moodle login page is unavailable.")
        form = BeautifulSoup(page.text, "html.parser").select_one('form#login')
        token = form.select_one('input[name="logintoken"]') if form else None
        if not token or not token.get("value"):
            raise MoodleError("Moodle login form is unavailable.")
        response = await client.post(f"{ORIGIN}/login/index.php",
                                     data={"username": username, "password": password,
                                           "logintoken": token["value"], "anchor": ""})
        if not _on_moodle(str(response.url)):
            raise MoodleError("Moodle requires another sign-in step. Finish it on Moodle, then try again.")
        if "/login/" in response.url.path:
            raise MoodleError("Moodle username or password is incorrect.")
        try:
            sesskey = await _dashboard(client)
        except MoodleError as exc:
            raise MoodleError("Moodle username or password is incorrect, or another sign-in step is required.") from exc
        cookies = {cookie.name: cookie.value for cookie in client.cookies.jar
                   if cookie.domain.lstrip(".") == HOST and cookie.name == SESSION_COOKIE}
        if SESSION_COOKIE not in cookies:
            raise MoodleError("Moodle did not create a session. Try again.")
        return cookies, await _deadlines(client, sesskey)


async def fetch_deadlines(cookies: dict) -> list[dict]:
    if not isinstance(cookies, dict) or not cookies.get(SESSION_COOKIE):
        raise MoodleError("Moodle session expired. Reconnect your account.")
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True,
                                 cookies={SESSION_COOKIE: cookies[SESSION_COOKIE]}) as client:
        return await _deadlines(client, await _dashboard(client))
