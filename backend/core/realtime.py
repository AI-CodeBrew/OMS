"""Wires the in-process event bus (core.events) to two effects:

1. Dropping the Redis-cached Orders/Dashboard payloads (core/redis_client.py)
2. Pushing a message to any browser currently connected over WebSocket for
   that organization (core/consumers.py), carrying the fresh counts and
   (when the event is about one order) that order's fresh row, so the open
   tab can patch just what changed instead of always refetching everything
   - the frontend still falls back to a full reload for events this can't
   describe precisely enough (e.g. order.created with no existing row to
   patch, or if serializing failed here).

Subscribed once at startup from CoreConfig.ready() - see core/apps.py.
Follows the pattern oms/signals.py documents for reacting to events
published elsewhere: order.created/order.updated (oms/services.py,
integrations/services.py - including the Shopify webhook path and the
Smartlane webhook/poller's tracking-only branch) and order.status_changed
(oms/services.py) all land here without those call sites needing to know
caching or WebSockets exist.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .events import subscribe
from .redis_client import invalidate_order_view_cache, next_counts_version, set_cached_counts

logger = logging.getLogger(__name__)

ORDER_EVENTS = ("order.created", "order.updated", "order.status_changed")


def _group_name(organization_id):
    return f"org_{organization_id}_orders"


def _refresh_counts(organization_id):
    """Rewrite the counts cache instead of leaving it empty, and return what
    was computed so _on_order_event can hand it straight to the browser
    instead of every open tab re-querying it over REST a moment later.

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

        # Claimed *before* the query below, not after - see
        # redis_client.next_counts_version for why this ordering is what
        # makes the freshest concurrent rebuild win the cache write.
        version = next_counts_version(organization_id)
        counts = compute_order_counts(organization_id)
        set_cached_counts(organization_id, counts, version=version)
        return counts
    except Exception:
        # Same rule as the push below: an order has already been committed,
        # and a cold cache only costs the next reader one query. Never let
        # this fail the write path.
        logger.warning("counts cache refresh failed for org %s", organization_id, exc_info=True)
        return None


def _serialize_order(order_id):
    """Best-effort fresh row for the order this event is about, in the
    exact shape the orders list already renders (same serializer), so the
    frontend can patch one row in place instead of refetching the whole
    table. Returns None on anything from "no order_id in this event" (e.g.
    order.created's own payload doesn't carry a pre-existing row to patch)
    to a deleted/unreadable order - the frontend falls back to its existing
    full-reload behavior whenever this comes back empty.

    Imported lazily for the same reason as compute_order_counts above.
    """
    if not order_id:
        return None
    try:
        from oms.models import Order
        from oms.serializers import OrderSerializer

        order = Order.all_objects.select_related("courier", "parent_order").get(id=order_id)
        return OrderSerializer(order).data
    except Exception:
        logger.warning("order serialize-for-push failed for order %s", order_id, exc_info=True)
        return None


def _on_order_event(sender, payload, **kwargs):
    organization_id = payload.get("organization_id")
    if not organization_id:
        return

    invalidate_order_view_cache(organization_id)
    counts = _refresh_counts(organization_id)
    order = _serialize_order(payload.get("order_id"))

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        message = {"type": "order.update", "event": sender, "payload": payload}
        if counts is not None:
            message["counts"] = counts
        if order is not None:
            message["order"] = order
        async_to_sync(channel_layer.group_send)(_group_name(organization_id), message)
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
