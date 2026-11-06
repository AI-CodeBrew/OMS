"""WebSocket consumer that tells every open browser tab on a given
organization's Orders page what changed - the fresh per-status counts and,
when the event was about one order, that order's fresh row, so the tab can
patch in place instead of always refetching. Paired with core/realtime.py,
which is what actually sends the messages this consumer forwards - this
file only knows how to authenticate, join/leave the right group, and relay
whatever it's given.
"""

import logging
import secrets
from urllib.parse import parse_qs, unquote

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import scan_sessions
from .jwt_utils import InvalidSupabaseToken, decode_supabase_jwt
from .middleware import resolve_active_org_id


def _is_member(organization_id, user_id):
    from .models import Membership

    return bool(user_id) and Membership.objects.filter(
        organization_id=organization_id, user_id=user_id
    ).exists()

logger = logging.getLogger(__name__)


class OrgOrdersConsumer(AsyncJsonWebsocketConsumer):
    """wss://<host>/ws/orders/?token=<supabase access token>

    Browsers can't attach a custom Authorization header to a WebSocket
    handshake, so the same Supabase access token normally sent as
    `Authorization: Bearer ...` (see authService.getAuthHeaders on the
    frontend) is passed as a query parameter instead. Verified with the
    exact same decode_supabase_jwt() the regular HTTP auth path uses
    (core/authentication.py, core/middleware.py) - no separate trust path,
    no separate secret.
    """

    async def connect(self):
        query = self.scope.get("query_string", b"").decode()
        params = dict(pair.split("=", 1) for pair in query.split("&") if "=" in pair)
        token = params.get("token")

        organization_ids = []
        if token:
            try:
                claims = await sync_to_async(decode_supabase_jwt)(token)
            except InvalidSupabaseToken:
                claims = None
            if claims:
                # Never user_metadata - the user can write that themselves.
                app_meta = claims.get("app_metadata") or {}
                if app_meta.get("role") == "super_admin":
                    hub = unquote(params.get("hub", ""))
                    if hub:
                        from .dispatch_hub_service import hub_scope_organization_ids

                        organization_ids = await sync_to_async(hub_scope_organization_ids)(hub)
                    else:
                        organization_id = await sync_to_async(resolve_active_org_id)(
                            unquote(params.get("org", ""))
                        )
                        organization_ids = [organization_id] if organization_id else []
                else:
                    # Same suspended/removed-org gate as TenantMiddleware.
                    organization_id = await sync_to_async(resolve_active_org_id)(
                        app_meta.get("organization_id")
                    )
                    # Same Membership gate as TenantMiddleware - a removed
                    # member's still-unexpired token gets no live feed.
                    if organization_id and not await sync_to_async(_is_member)(
                        organization_id, claims.get("sub")
                    ):
                        organization_id = None
                    organization_ids = [organization_id] if organization_id else []

        if not organization_ids:
            # 4401: unauthorized, mirrors the HTTP 401 this would get on a
            # normal API call with a missing/invalid/expired token.
            await self.close(code=4401)
            return

        # Several groups in Hub mode, exactly one otherwise - order_update
        # below doesn't care which group a message arrived through.
        self.group_names = [f"org_{org_id}_orders" for org_id in organization_ids]
        for group_name in self.group_names:
            await self.channel_layer.group_add(group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        for group_name in getattr(self, "group_names", None) or []:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    # Dispatched for every channel_layer.group_send({"type": "order.update",
    # ...}) call in core/realtime.py - Channels maps the "type" string to
    # this method name (dots become underscores) automatically. counts/order
    # are optional (core/realtime.py only attaches them when it managed to
    # compute them) - forwarded as-is so the frontend can patch a single row
    # instead of refetching everything; omitted entirely when absent rather
    # than sent as null, matching the frontend's `if (frame.order)` checks.
    async def order_update(self, message):
        out = {"event": message["event"], "payload": message["payload"]}
        if "counts" in message:
            out["counts"] = message["counts"]
        if "order" in message:
            out["order"] = message["order"]
        await self.send_json(out)


def _text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ""


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


# A return's key can hold its whole product name (wms.services.return_line_summary).
_MAX_RETURN_LINES = 200
_MAX_LINE_TEXT = 1000


def _rows(value):
    """Only the rows of a list that are objects, and not without limit."""
    return [r for r in value if isinstance(r, dict)][:_MAX_RETURN_LINES] if isinstance(value, list) else []


class ScanSessionConsumer(AsyncJsonWebsocketConsumer):
    """wss://<host>/ws/scan-session/?token=<token from core.scan_sessions>

    Passes frames between a laptop's browser tab ("host") and the phone it
    paired with, in both directions and nothing more: the phone reports a
    code, the laptop runs its normal scan and reports the outcome. Nothing
    here touches an order - that all happens on the laptop's own API calls.

    Phone -> laptop: {"type": "scan", "id", "code"}, {"type": "here"},
    {"type": "end"} (forwarded as phone_ended - the operator pressed the cross,
    as opposed to phone_left, which may only be a dropped connection)
    {"type": "count", "id", "order_number", "breakdown"} (a return counted on
    the phone, recorded by the laptop like its own popup's count)
    Laptop -> phone: {"type": "result", "id", "status", "order_number",
    "message", "lines"} ("lines" when status is "count": the return to count),
    {"type": "hello", "title", "field"}, {"type": "ended"} (a cross pressed on
    any phone of this session has ended it)
    Sent on joining/leaving: phone_joined / phone_left to the laptop,
    host_joined / host_left to the phone.

    From this consumer itself: {"type": "qr", "token"} to the laptop, on
    connecting and whenever it sends {"type": "new_qr"}, and
    {"type": "session", "token"} to a phone that connected with a QR token -
    the longer-lived one it reconnects with from then on.
    """

    async def connect(self):
        params = parse_qs(self.scope.get("query_string", b"").decode())
        session = scan_sessions.read_token((params.get("token") or [""])[0])
        if session is None:
            # Accept first: a handshake refused outright reaches the browser
            # as a generic 1006, which looks like a network drop and gets
            # retried forever. The client needs to see 4401 to know to stop.
            await self.accept()
            await self.close(code=4401)
            return

        self.session_id, self.role, from_qr = session
        self.is_phone = self.role == scan_sessions.ROLE_PHONE
        # Only ever shown to the laptop, to tell its phones apart.
        self.peer_id = secrets.token_hex(4)
        self.own_group = f"scan_{self.session_id}_{self.role}"
        other_role = scan_sessions.ROLE_HOST if self.is_phone else scan_sessions.ROLE_PHONE
        self.other_group = f"scan_{self.session_id}_{other_role}"

        # Before accept: with the channel layer down (Redis unreachable) the
        # connection must never look open. Accepting first showed the laptop a
        # QR code that vanished a moment later, over and over.
        await self.channel_layer.group_add(self.own_group, self.channel_name)
        await self.accept()

        if not self.is_phone:
            await self._send_qr()
        elif from_qr:
            await self.send_json(
                {"type": "session", "token": scan_sessions.phone_token(self.session_id)}
            )
        await self._announce("joined")

    async def _send_qr(self):
        await self.send_json({"type": "qr", "token": scan_sessions.qr_token(self.session_id)})

    async def disconnect(self, close_code):
        if not getattr(self, "own_group", None):
            return
        await self._announce("left")
        await self.channel_layer.group_discard(self.own_group, self.channel_name)

    async def _announce(self, state):
        if self.is_phone:
            await self._to_other({"type": f"phone_{state}", "peer": self.peer_id})
        else:
            await self._to_other({"type": f"host_{state}"})

    async def _to_other(self, frame):
        await self.channel_layer.group_send(
            self.other_group, {"type": "relay.frame", "frame": frame}
        )

    async def receive_json(self, content, **kwargs):
        # A connection whose token was refused is on its way out.
        if not getattr(self, "own_group", None) or not isinstance(content, dict):
            return
        kind = content.get("type")
        if not self.is_phone and kind == "new_qr":
            await self._send_qr()
            return
        frame = None
        if self.is_phone and kind == "scan":
            code = _text(content.get("code"), 255)
            if code:
                frame = {"type": "scan", "id": _text(content.get("id"), 64), "code": code}
        elif self.is_phone and kind == "here":
            frame = {"type": "phone_joined", "peer": self.peer_id}
        elif self.is_phone and kind == "end":
            frame = {"type": "phone_ended", "peer": self.peer_id}
        elif self.is_phone and kind == "count":
            frame = {
                "type": "count",
                "id": _text(content.get("id"), 64),
                "order_number": _text(content.get("order_number"), 255),
                "breakdown": [
                    {
                        "key": _text(row.get("key"), _MAX_LINE_TEXT),
                        "good": _count(row.get("good")),
                        "damaged": _count(row.get("damaged")),
                        "lost": _count(row.get("lost")),
                    }
                    for row in _rows(content.get("breakdown"))
                ],
            }
        elif not self.is_phone and kind == "ended":
            frame = {"type": "ended"}
        elif not self.is_phone and kind == "result":
            frame = {
                "type": "result",
                "id": _text(content.get("id"), 64),
                "status": _text(content.get("status"), 16),
                "order_number": _text(content.get("order_number"), 255),
                "message": _text(content.get("message"), 500),
                "lines": [
                    {
                        "key": _text(row.get("key"), _MAX_LINE_TEXT),
                        "sku": _text(row.get("sku"), 255),
                        "product_name": _text(row.get("product_name"), _MAX_LINE_TEXT),
                        "quantity": _count(row.get("quantity")),
                    }
                    for row in _rows(content.get("lines"))
                ],
            }
        elif not self.is_phone and kind == "hello":
            frame = {
                "type": "hello",
                "title": _text(content.get("title"), 120),
                "field": _text(content.get("field"), 120),
            }
        if frame:
            await self._to_other(frame)

    async def relay_frame(self, message):
        await self.send_json(message["frame"])
