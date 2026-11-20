"""Tokens that pair a laptop's Scan panel with a phone used as its scanner.

The phone never logs in. It calls the scan APIs itself (the same endpoints the
laptop's Scan panel calls), sending its token in the X-Scan-Session header, and
TenantMiddleware runs the call as the login and store the laptop had when Scan
was pressed (a ScanSession row, made by create_session). So once paired, the
phone keeps scanning with the laptop asleep, logged out or shut - only the
phone's cross ends it (end_session). While the laptop's tab is open it still
hears about every scan over core.consumers.ScanSessionConsumer, for its log and
lists, and it can point the phone at another desk.

Three tokens, all naming one session:
- the laptop's own, from create_session();
- the QR code's, short-lived so a code seen or photographed earlier is useless;
- the phone's, handed over the socket once a QR code is used, so the phone can
  come back after a network drop or a locked screen without a new QR code.

The tokens are signed, and carry only the session id and role. What a session
may do lives in its row, so ending it there stops every token at once.

Sessions made before ScanSession existed have a random hex id and no row: the
socket still pairs them, but they can't call the APIs - their phone is asked to
scan a new QR code.
"""

import uuid

from django.core import signing
from django.utils import timezone

ROLE_HOST = "host"
ROLE_PHONE = "phone"

_SESSION_SALT = "core.scan_session"
_QR_SALT = "core.scan_session.qr"
# The laptop shows a new code every minute (lib/phoneScanSession.js) and never
# shows one older than 110 seconds; the extra minute is for a phone that read
# the code just before it changed (2 minutes - the user's choice, 2026-11-20;
# it was 90 seconds).
_QR_MAX_AGE_SECONDS = 120

# The only endpoints a phone's token may call - one per scan desk (frontend
# lib/scanDesks.js), plus receiving a return counted on the phone.
PHONE_API_PATHS = frozenset(
    {
        "/api/oms/orders/scan-pack/",
        "/api/oms/orders/scan-dispatch/",
        "/api/wms/packing/scan/",
        "/api/wms/returns/lookup/",
        "/api/wms/returns/scan/",
    }
)


def _sign(session_id, role, salt):
    return signing.dumps({"s": session_id, "r": role}, salt=salt)


def create_session(request):
    """A new session for the signed-in laptop making `request`."""
    from .middleware import ACT_AS_HEADER, HUB_HEADER
    from .models import ScanSession

    app_meta = (getattr(request, "auth_claims", None) or {}).get("app_metadata") or {}
    modules = app_meta.get("modules")
    is_super_admin = bool(getattr(request, "is_super_admin", False))
    session = ScanSession.objects.create(
        user_id=request.user_id,
        email=(getattr(request, "auth_email", "") or "")[:255],
        role=str(app_meta.get("role") or "")[:32],
        organization_id=app_meta.get("organization_id") or None,
        modules=modules if isinstance(modules, list) else None,
        act_as_organization_id=(request.META.get(ACT_AS_HEADER) or "")[:64] if is_super_admin else "",
        hub=(request.META.get(HUB_HEADER) or "")[:16] if is_super_admin else "",
        admin_staff=bool(app_meta.get("admin_staff")),
    )
    return {"host_token": _sign(str(session.id), ROLE_HOST, _SESSION_SALT)}


def qr_token(session_id):
    return _sign(session_id, ROLE_PHONE, _QR_SALT)


def phone_token(session_id):
    return _sign(session_id, ROLE_PHONE, _SESSION_SALT)


def read_token(token):
    """(session_id, role, from_qr), or None for a missing, tampered or expired
    token. Says nothing about whether the session has been ended."""
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


def _session_row(session_id):
    """The session's ScanSession row, or None for one made before they existed."""
    from .models import ScanSession

    try:
        key = uuid.UUID(str(session_id))
    except ValueError:
        return None
    return ScanSession.objects.filter(id=key).first()


def is_ended(session_id):
    row = _session_row(session_id)
    return bool(row and row.ended_at)


def end_session(session_id):
    """The phone's cross: none of this session's tokens work from now on."""
    from .models import ScanSession

    row = _session_row(session_id)
    if row and not row.ended_at:
        ScanSession.objects.filter(id=row.id, ended_at__isnull=True).update(ended_at=timezone.now())


def phone_session(token):
    """The live ScanSession a phone's token belongs to, or None."""
    session = read_token(token)
    if session is None:
        return None
    session_id, role, _from_qr = session
    if role != ROLE_PHONE:
        return None
    row = _session_row(session_id)
    if row is None or row.ended_at:
        return None
    return row


def claims_for(session):
    """The same shape as the Supabase JWT claims TenantMiddleware reads, from
    the laptop's sign-in this session was made under."""
    app_meta = {"role": session.role}
    if session.organization_id:
        app_meta["organization_id"] = str(session.organization_id)
    if isinstance(session.modules, list):
        app_meta["modules"] = session.modules
    if session.admin_staff:
        app_meta["admin_staff"] = True
    return {"sub": str(session.user_id), "email": session.email, "app_metadata": app_meta}
