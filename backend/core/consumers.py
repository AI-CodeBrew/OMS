"""WebSocket consumer that tells every open browser tab on a given
organization's Orders page what changed - the fresh per-status counts and,
when the event was about one order, that order's fresh row, so the tab can
patch in place instead of always refetching. Paired with core/realtime.py,
which is what actually sends the messages this consumer forwards - this
file only knows how to authenticate, join/leave the right group, and relay
whatever it's given.
"""

import logging
from urllib.parse import unquote

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .jwt_utils import InvalidSupabaseToken, decode_supabase_jwt
from .middleware import resolve_active_org_id

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
                app_meta = claims.get("app_metadata") or {}
                user_meta = claims.get("user_metadata") or {}
                if app_meta.get("role") == "super_admin":
                    if unquote(params.get("hub", "")) == "1":
                        from .dispatch_hub_service import active_hub_organization_ids

                        organization_ids = await sync_to_async(active_hub_organization_ids)()
                    else:
                        organization_id = await sync_to_async(resolve_active_org_id)(
                            unquote(params.get("org", ""))
                        )
                        organization_ids = [organization_id] if organization_id else []
                else:
                    # Same suspended/removed-org gate as TenantMiddleware.
                    organization_id = await sync_to_async(resolve_active_org_id)(
                        app_meta.get("organization_id") or user_meta.get("organization_id")
                    )
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
