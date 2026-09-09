"""Wires the in-process event bus (core.events) to two effects:

1. Dropping the Redis-cached Orders/Dashboard payloads (core/redis_client.py)
2. Pushing a "something changed" message to any browser currently
   connected over WebSocket for that organization (core/consumers.py)
   so the open tab refetches and the cache is rebuilt from fresh data.

Subscribed once at startup from CoreConfig.ready() - see core/apps.py.
Follows the pattern oms/signals.py documents for reacting to events
published elsewhere: order.created/order.updated (oms/services.py,
integrations/services.py - including the Shopify webhook path) and
order.status_changed (oms/services.py) all land here without those call
sites needing to know caching or WebSockets exist.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .events import subscribe
from .redis_client import invalidate_order_view_cache, set_cached_counts

logger = logging.getLogger(__name__)

ORDER_EVENTS = ("order.created", "order.updated", "order.status_changed")


def _group_name(organization_id):
    return f"org_{organization_id}_orders"


def _refresh_counts(organization_id):
    """Rewrite the counts cache instead of leaving it empty.

    Dropping the key and telling every open tab to refetch in the same
    breath means they all miss together and each runs the same aggregate
    against Postgres. Counts are one cheap GROUP BY and the single hottest
    payload (every status-tab click asks for it), so it is worth rebuilding
    once here rather than N times across the herd. The list/dashboard keys
    stay invalidate-only - there is a key per status/page/size combination
    and eagerly rebuilding all of them would cost far more than it saves;
    those are protected by the rebuild lock in oms/views.py instead.

    Imported lazily because core must not import oms at module scope - oms
    already imports core, and CoreConfig.ready() runs while the app
    registry is still populating.
    """
    try:
        from oms.services import compute_order_counts

        set_cached_counts(organization_id, compute_order_counts(organization_id))
    except Exception:
        # Same rule as the push below: an order has already been committed,
        # and a cold cache only costs the next reader one query. Never let
        # this fail the write path.
        logger.warning("counts cache refresh failed for org %s", organization_id, exc_info=True)


def _on_order_event(sender, payload, **kwargs):
    organization_id = payload.get("organization_id")
    if not organization_id:
        return

    invalidate_order_view_cache(organization_id)
    _refresh_counts(organization_id)

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            _group_name(organization_id),
            {"type": "order.update", "event": sender, "payload": payload},
        )
    except Exception:
        # Never let a broken/unreachable Redis take down order processing -
        # the request/webhook that published this event already committed
        # its DB write. A missed live-update push just means the browser
        # catches up on its next normal load() instead of instantly, same
        # as before this existed.
        logger.warning("realtime push failed for org %s", organization_id, exc_info=True)


def register():
    for event_name in ORDER_EVENTS:
        subscribe(event_name, _on_order_event)
