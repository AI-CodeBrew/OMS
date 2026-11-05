"""Tokens that pair a laptop's Scan panel with a phone used as its scanner.

The phone never logs in and never calls the order APIs: it only relays the
codes it reads to the laptop (core.consumers.ScanSessionConsumer), and the
laptop runs its normal scan flow under its own login and store. So a token
needs no user or organization, and it does nothing while that laptop's browser
tab is closed - nothing is listening on that session then.

Three tokens, all for one session:
- the laptop's own, from create_session();
- the QR code's, short-lived so a code seen or photographed earlier is useless;
- the phone's, handed over the socket once a QR code is used, so the phone can
  come back after a network drop or a locked screen without a new QR code.

Only the QR code's token expires, so scanning is never cut off halfway through
the work. The phone stays paired until the operator presses the cross on it,
which discards its token. The laptop keeps its own for the life of the browser
tab (lib/phoneScanSession.js), so a page refresh there doesn't end anything;
once that tab is closed nothing can host the session again, and the phone's
token reaches nobody.

Signed rather than stored, so a session needs no table and no Redis key.
"""

import secrets

from django.core import signing

ROLE_HOST = "host"
ROLE_PHONE = "phone"

_SESSION_SALT = "core.scan_session"
_QR_SALT = "core.scan_session.qr"
# The laptop shows a new code every minute (lib/phoneScanSession.js); the extra
# half minute is for a phone that read the code just before it changed.
_QR_MAX_AGE_SECONDS = 90


def _sign(session_id, role, salt):
    return signing.dumps({"s": session_id, "r": role}, salt=salt)


def create_session():
    return {"host_token": _sign(secrets.token_hex(12), ROLE_HOST, _SESSION_SALT)}


def qr_token(session_id):
    return _sign(session_id, ROLE_PHONE, _QR_SALT)


def phone_token(session_id):
    return _sign(session_id, ROLE_PHONE, _SESSION_SALT)


def read_token(token):
    """(session_id, role, from_qr), or None for a missing, tampered or expired
    token."""
    for salt, max_age, from_qr in (
        (_SESSION_SALT, None, False),
        (_QR_SALT, _QR_MAX_AGE_SECONDS, True),
    ):
        try:
            payload = signing.loads(token or "", salt=salt, max_age=max_age)
        except signing.BadSignature:
            continue
        return payload["s"], payload["r"], from_qr
    return None
