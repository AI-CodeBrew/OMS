"""Absolute session lifetime: every sign-in lasts SESSION_MAX_AGE_SECONDS
(12 hours) from the moment the user typed their password - not from the
last click, and not from the last token refresh.

The start time comes from the Supabase access token itself: its signed
`amr` claim holds the sign-in's timestamp and is carried unchanged into
every refreshed token (refreshes only move `iat`/`exp`), so page reloads,
store switches and module changes can never push the deadline back - and
the user can't edit it either, the token being verified before this runs.

A session the user logged out of (or that Supabase ended itself) is also
refused straight away: the token's `session_id` must still be a row in
Supabase's auth.sessions - logging out deletes it. Checked against the
database at most every SESSION_ROW_CACHE_SECONDS per session.

Used by TenantMiddleware (every API call) and the orders WebSocket."""

import logging
import threading
import time

from django.conf import settings
from django.db import DatabaseError, connection

logger = logging.getLogger(__name__)

SESSION_EXPIRED_CODE = "session_expired"
SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again to continue."
SESSION_ENDED_CODE = "session_ended"
SESSION_ENDED_MESSAGE = "You have been signed out. Please sign in again to continue."

SESSION_ROW_CACHE_SECONDS = 10
_MAX_CACHED = 5000

# {session_id: (checked_at_monotonic, not_after_epoch_or_None)} - sessions
# seen alive recently; a missing session is never cached (always refused).
_alive = {}
_lock = threading.Lock()


def max_age_seconds():
    return int(getattr(settings, "SESSION_MAX_AGE_SECONDS", 12 * 3600))


def session_started_at(claims):
    """Epoch seconds the user signed in - the earliest `amr` timestamp.
    None when the token carries none (never the case for Supabase user
    tokens; refused by session_problem)."""
    stamps = []
    for entry in claims.get("amr") or []:
        if isinstance(entry, dict):
            try:
                stamps.append(int(entry.get("timestamp")))
            except (TypeError, ValueError):
                continue
    return min(stamps) if stamps else None


def _session_row(session_id):
    """(exists, not_after_epoch) for a Supabase session; (True, None) when
    the table can't be read, so a database hiccup never signs everyone out
    (the 12-hour limit still applies - it needs no database)."""
    now = time.monotonic()
    with _lock:
        cached = _alive.get(session_id)
    if cached and now - cached[0] < SESSION_ROW_CACHE_SECONDS:
        return True, cached[1]
    try:
        with connection.cursor() as cursor:
            cursor.execute("select not_after from auth.sessions where id = %s", [session_id])
            row = cursor.fetchone()
    except DatabaseError:
        logger.warning("session check: couldn't read auth.sessions", exc_info=True)
        return True, None
    if row is None:
        with _lock:
            _alive.pop(session_id, None)
        return False, None
    not_after = row[0].timestamp() if row[0] else None
    with _lock:
        if len(_alive) >= _MAX_CACHED:
            _alive.clear()
        _alive[session_id] = (now, not_after)
    return True, not_after


def session_problem(claims, *, check_row=True):
    """None when the verified token's session may be used, else
    SESSION_EXPIRED_CODE (12 hours since sign-in, or no sign-in time) or
    SESSION_ENDED_CODE (logged out / ended by Supabase)."""
    started = session_started_at(claims)
    if started is None or time.time() >= started + max_age_seconds():
        return SESSION_EXPIRED_CODE
    session_id = claims.get("session_id")
    if check_row and session_id and getattr(settings, "SESSION_CHECK_REVOKED", True):
        exists, not_after = _session_row(str(session_id))
        if not exists:
            return SESSION_ENDED_CODE
        if not_after is not None and time.time() >= not_after:
            return SESSION_EXPIRED_CODE
    return None


def problem_message(code):
    return SESSION_ENDED_MESSAGE if code == SESSION_ENDED_CODE else SESSION_EXPIRED_MESSAGE
