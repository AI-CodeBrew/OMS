"""Status pushes to Shopify, in the background.

Every order status change used to update Shopify (fulfillment + tags, about
six Shopify calls) before the request could move on - ~8 of the ~10 seconds
each courier booking took. Now oms.services._transition only queues the
order here, after its transaction commits, and one worker thread per server
process makes the pushes in order.

- An order queued again before the worker reaches it is pushed once, with
  its latest state - a booking's Booking Pending -> Ready to Print makes one
  push, not two. The worker takes the order off the pending set BEFORE
  reading it, so a change made while its push runs queues it again.
- What Shopify refuses is logged and written to the audit log as
  order.shopify_sync_failed, as before.
- A queue lives in memory: a push still waiting when the server restarts
  (a deploy) is lost. Integrations > Shopify > "Push all statuses now"
  (push_statuses_to_shopify) sends every order's current status again.
- settings.SHOPIFY_PUSH_ASYNC = False pushes straight away instead (tests,
  scripts that want the old behaviour).
"""

import logging
import queue
import threading

from django.conf import settings
from django.db import close_old_connections, transaction

logger = logging.getLogger(__name__)

_queue = queue.Queue()
_pending = set()
_lock = threading.Lock()
_worker = None


def queue_order_push(order):
    """Push `order`'s current status to Shopify once its transaction
    commits - in the background unless SHOPIFY_PUSH_ASYNC is off. Orders
    that didn't come from Shopify are skipped here already."""
    if not order.shopify_order_id:
        return
    if not getattr(settings, "SHOPIFY_PUSH_ASYNC", True):
        push_now(order.pk)
        return
    order_id = order.pk
    transaction.on_commit(lambda: _enqueue(order_id))


def _enqueue(order_id):
    global _worker
    with _lock:
        if order_id in _pending:
            return
        _pending.add(order_id)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="shopify-push", daemon=True)
            _worker.start()
    _queue.put(order_id)


def _run():
    while True:
        order_id = _queue.get()
        with _lock:
            _pending.discard(order_id)
        try:
            close_old_connections()
            # Nobody waits on it here, so a Shopify 429 is waited out
            # (Retry-After) rather than counted as a failed push.
            from . import shopify_client

            with shopify_client.wait_out_rate_limits():
                push_now(order_id)
        except Exception:  # noqa: BLE001 - the worker must survive any one order
            logger.exception("Shopify push worker: order %s failed", order_id)
        finally:
            close_old_connections()
            _queue.task_done()


def push_now(order_id):
    """Sends one order's current status to Shopify and records what
    Shopify refused (log + audit log). Never raises."""
    from oms.models import Order

    from .services import sync_order_to_shopify

    order = Order.all_objects.select_related("courier").filter(pk=order_id).first()
    if order is None:
        return
    try:
        errors = sync_order_to_shopify(order)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Shopify status push crashed for order %s", order.order_number)
        errors = [str(exc)]
    if not errors:
        return
    logger.warning(
        "Shopify status push failed for order %s (%s): %s",
        order.order_number, order.status, "; ".join(errors),
    )
    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=order.organization_id,
            action="order.shopify_sync_failed",
            summary=f"Order {order.order_number}: couldn't update Shopify to {order.status}",
            entity_type="order",
            entity_id=str(order.id),
            metadata={
                "order_number": order.order_number,
                "to_status": order.status,
                "errors": [e[:500] for e in errors[:5]],
            },
            status_code=502,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to write Shopify sync audit log for %s", order.order_number)


def wait_until_idle():
    """Blocks until every queued push is done - for tests and scripts."""
    _queue.join()
