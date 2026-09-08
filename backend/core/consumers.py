"""WebSocket consumer that tells every open browser tab on a given
organization's Orders page "something changed, go refetch." Paired with
core/realtime.py, which is what actually sends the messages this consumer
forwards - this file only knows how to authenticate, join/leave the right
group, and relay whatever it's given.
"""

import logging

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .jwt_utils import InvalidSupabaseToken, decode_supabase_jwt

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

        organization_id = None
        if token:
            try:
                claims = await sync_to_async(decode_supabase_jwt)(token)
            except InvalidSupabaseToken:
                claims = None
            if claims:
                app_meta = claims.get("app_metadata") or {}
                user_meta = claims.get("user_metadata") or {}
                organization_id = app_meta.get("organization_id") or user_meta.get(
                    "organization_id"
                )

        if not organization_id:
            # 4401: unauthorized, mirrors the HTTP 401 this would get on a
            # normal API call with a missing/invalid/expired token.
            await self.close(code=4401)
            return

        self.group_name = f"org_{organization_id}_orders"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if getattr(self, "group_name", None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    # Dispatched for every channel_layer.group_send({"type": "order.update",
    # ...}) call in core/realtime.py - Channels maps the "type" string to
    # this method name (dots become underscores) automatically.
    async def order_update(self, message):
        await self.send_json({"event": message["event"], "payload": message["payload"]})
