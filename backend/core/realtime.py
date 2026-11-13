"""Wires the in-process event bus (core.events) to two effects:

1. Dropping the Redis-cached Orders/Dashboard payloads (core/redis_client.py)
2. Pushing a message to any browser currently connected over WebSocket for
   that organization (core/consumers.py), carrying the fresh counts and
   (when the event is about one order) that order's fresh row, so the open
   tab can patch just what changed instead of always refetching everything
   - the frontend still falls back to a full reload for events this can't
   describe precisely enough (e.g. order.created with no existing row to
   patch, or if serializing failed here).

Batched, off the request: this used to run in full for every single order
event, inline - clear the store's cache, recount every order in the store,
serialize the row, push - so a courier sync moving 300 orders recounted the
store 300 times before it could carry on, and a bulk action on 100 orders
waited on 100 recounts. That was the main thing slowing status updates
down. Now an event only notes which order changed (after its transaction
commits, so nothing half-written is ever read), and a background worker
handles whatever piled up every FLUSH_DELAY_SECONDS: per store, the cache
is cleared once, the counts rebuilt once (in that store's tenant context -
the inline version ran with whatever context the caller had, which for
webhooks and pollers was none, i.e. zero counts), every changed row is
serialized in one query, and one push per order goes out carrying them.

The cache is still also cleared right away on the first event of a burst
(at most every INVALIDATE_EVERY_SECONDS per store), so a reload made the
moment an action returns never reads the old cached page; the worker's own
clear at the end of the burst catches anything cached in between.

Subscribed once at startup from CoreConfig.ready() - see core/apps.py.
Follows the pattern oms/signals.py documents for reacting to events
published elsewhere: order.created/order.updated (oms/services.py,
integrations/services.py - including the Shopify webhook path and the
Smartlane webhook/poller's tracking-only branch) and order.status_changed
(oms/services.py) all land here without those call sites needing to know
caching or WebSockets exist.
"""

import atexit
import json
import logging
import threading
import time

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import connections, transaction
from rest_framework.utils.encoders import JSONEncoder

from .events import subscribe
from .redis_client import invalidate_order_view_cache, next_counts_version, set_cached_counts

logger = logging.getLogger(__name__)

ORDER_EVENTS = ("order.created", "order.updated", "order.status_changed")

# How long the worker lets a burst pile up before handling it - short enough
# that a change still reaches open screens within about a second.
FLUSH_DELAY_SECONDS = 0.4
# The immediate (in-request) cache clear happens at most this often per store.
INVALIDATE_EVERY_SECONDS = 1.0

_lock = threading.Lock()
_wake = threading.Event()
# {organization_id: [(event name, payload), ...]} waiting for the worker.
_pending = {}
_last_invalidated = {}
_worker = None


def _group_name(organization_id):
    return f"org_{organization_id}_orders"


def _refresh_counts(organization_id):
    """Rewrite the counts cache instead of leaving it empty, and return what
    was computed so it can go straight to the browser instead of every open
    tab re-querying it over REST a moment later. Once per store per flush.
    Run in the store's own tenant context - compute_order_counts reads
    through the tenant-scoped manager.

    Imported lazily because core must not import oms at module scope - oms
    already imports core, and CoreConfig.ready() runs while the app
    registry is still populating.
    """
    try:
        from oms.services import compute_order_counts

        from .context import tenant_context

        # Claimed *before* the query below, not after - see
        # redis_client.next_counts_version for why this ordering is what
        # makes the freshest concurrent rebuild win the cache write.
        version = next_counts_version(organization_id)
        with tenant_context(organization_id):
            counts = compute_order_counts(organization_id)
        set_cached_counts(organization_id, counts, version=version)
        return counts
    except Exception:
        # A cold cache only costs the next reader one query.
        logger.warning("counts cache refresh failed for org %s", organization_id, exc_info=True)
        return None


def _serialize_orders(order_ids):
    """{order id: fresh row} for these orders, in the exact shape the orders
    list renders (same serializer), in one query. A missing/unreadable
    order is simply absent - the frontend then falls back to a full reload
    for that event."""
    if not order_ids:
        return {}
    try:
        from oms.models import Order
        from oms.serializers import OrderSerializer
        from oms.services import with_ticket_counts

        # Same loading as the orders list (OrderViewSet.get_queryset): the
        # joins, the line items in one go and the ticket counts annotated -
        # without them each row cost ~7 queries of its own.
        orders = list(
            with_ticket_counts(
                Order.all_objects.filter(id__in=list(order_ids))
                .select_related("courier", "parent_order", "organization")
                .prefetch_related("items")
            )
        )
        # Round-trip through JSON: the serializer's output still holds raw
        # UUID/Decimal/datetime objects, which the Redis channel layer's
        # msgpack can't encode - group_send then failed on every push.
        rows = json.loads(json.dumps(OrderSerializer(orders, many=True).data, cls=JSONEncoder))
        return {str(row.get("id")): row for row in rows if isinstance(row, dict)}
    except Exception:
        logger.warning("order serialize-for-push failed for %s order(s)", len(order_ids), exc_info=True)
        return {}


def _flush_org(organization_id, events):
    invalidate_order_view_cache(organization_id)
    counts = _refresh_counts(organization_id)

    # One push per order (its latest event), plus any event about no
    # particular order - a burst touching one order five times sends once.
    latest = {}
    unattached = []
    for sender, payload in events:
        order_id = payload.get("order_id")
        if order_id:
            latest.pop(str(order_id), None)
            latest[str(order_id)] = (sender, payload)
        else:
            unattached.append((sender, payload))
    # The store's tenant context: the row's nested parts (line items, ...)
    # read through tenant-scoped managers, empty without it.
    from .context import tenant_context

    with tenant_context(organization_id):
        rows = _serialize_orders(latest.keys())

    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    send = async_to_sync(channel_layer.group_send)
    for order_id, (sender, payload) in list(latest.items()) + [(None, e) for e in unattached]:
        message = {"type": "order.update", "event": sender, "payload": payload}
        if counts is not None:
            message["counts"] = counts
        row = rows.get(order_id) if order_id else None
        if row is not None:
            message["order"] = row
        try:
            send(_group_name(organization_id), message)
        except Exception:
            # Never let a broken/unreachable Redis take down order
            # processing - a missed push only means the browser catches up
            # on its next normal load(). Don't hammer a dead Redis with the
            # rest of the burst either.
            logger.warning("realtime push failed for org %s", organization_id, exc_info=True)
            return


def _drain():
    with _lock:
        batch = dict(_pending)
        _pending.clear()
    for organization_id, events in batch.items():
        try:
            _flush_org(organization_id, events)
        except Exception:
            logger.exception("realtime flush failed for org %s", organization_id)


def _run():
    while True:
        _wake.wait()
        # Let the rest of the burst arrive.
        time.sleep(FLUSH_DELAY_SECONDS)
        _wake.clear()
        try:
            _drain()
        except Exception:
            logger.exception("realtime worker: flush failed")
        finally:
            # This thread's own database connection - hand it back between
            # bursts, the pool is small (see settings.base DATABASES).
            connections.close_all()


def _ensure_worker():
    global _worker
    if _worker is not None and _worker.is_alive():
        return
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _worker = threading.Thread(target=_run, name="realtime-flush", daemon=True)
        _worker.start()


def _enqueue(organization_id, sender, payload):
    with _lock:
        _pending.setdefault(str(organization_id), []).append((sender, payload))
    _ensure_worker()
    _wake.set()


def _invalidate_now(organization_id):
    """The immediate cache clear - at most every INVALIDATE_EVERY_SECONDS
    per store, the worker clears again at the end of the burst."""
    now = time.monotonic()
    key = str(organization_id)
    with _lock:
        last = _last_invalidated.get(key)
        if last is not None and now - last < INVALIDATE_EVERY_SECONDS:
            return
        _last_invalidated[key] = now
    invalidate_order_view_cache(organization_id)


def _on_order_event(sender, payload, **kwargs):
    organization_id = payload.get("organization_id")
    if not organization_id:
        return
    _invalidate_now(organization_id)
    # After the write commits (at once outside a transaction): the worker
    # reads the order from its own connection, and must see the new state.
    transaction.on_commit(lambda: _enqueue(organization_id, sender, payload))


@atexit.register
def _flush_on_exit():
    """A script or management command that exits right after its last
    change still clears the cache and pushes - instead of leaving the
    burst's final state uncached-but-stale for the worker that died with
    the process."""
    try:
        if _pending:
            _drain()
    except Exception:
        pass


def register():
    for event_name in ORDER_EVENTS:
        subscribe(event_name, _on_order_event)
