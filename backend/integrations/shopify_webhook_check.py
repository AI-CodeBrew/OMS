"""Keeps OMS's own order webhooks registered on the Shopify stores whose
"Keep updating orders from Shopify" switch is on (services.SHOPIFY_RESYNC_STORES).

Why: those stores are connected through the FynkTech AI connector app,
which registers Shopify's order webhooks against ITSELF and doesn't pass
them on to OMS - so a Shopify edit never reached OMS (user, 2026-11-17).
OMS registers orders/create + orders/updated against its own endpoint
instead (same signing secret, so views.shopify_order_webhook accepts them).
The connector and its webhooks are left as they are.

The connector's tokens last an hour and may be dead when this runs (401):
then nothing happens and the next round tries again - so a store that is
reconnected later gets its webhooks within one interval, with nobody
having to do anything. Every other store is never touched.

A plain daemon thread like the courier pollers (integrations/poller.py),
started from IntegrationsConfig.ready() behind SHOPIFY_WEBHOOK_CHECK.
"""

import logging
import threading
import time

logger = logging.getLogger(__name__)

ORDER_TOPICS = ("orders/create", "orders/updated")

_started = False
_lock = threading.Lock()


def oms_order_webhook_address():
    from django.conf import settings
    from django.urls import reverse

    return f"{settings.PUBLIC_BACKEND_URL.rstrip('/')}{reverse('shopify-order-webhook')}"


def ensure_oms_order_webhooks(connection):
    """Registers whichever of ORDER_TOPICS isn't yet registered against
    OMS's address on `connection`'s shop. Returns the topics it added ([] if
    all were there). Raises shopify_client.ShopifyAPIError when the shop
    can't be read (e.g. an expired token)."""
    from django.conf import settings

    from . import shopify_client

    version = settings.SHOPIFY_API_VERSION
    address = oms_order_webhook_address()
    existing = shopify_client.list_webhooks(connection.shop_domain, connection.access_token, version)
    have = {(w.get("topic"), w.get("address")) for w in existing}
    added = []
    for topic in ORDER_TOPICS:
        if (topic, address) in have:
            continue
        webhook = shopify_client.register_webhook(
            connection.shop_domain, connection.access_token, version, topic, address
        )
        added.append(topic)
        # Kept with the connection's own ids, so a Disconnect removes them too.
        connection.webhook_ids = [*(connection.webhook_ids or []), webhook["id"]]
        connection.save(update_fields=["webhook_ids"])
    if added:
        logger.info("shopify webhook check: %s - registered %s on OMS", connection.shop_domain, added)
    return added


def check_resync_stores():
    """One round: every connected store with the switch on."""
    from core.models import Organization

    from . import shopify_client
    from .models import ShopifyConnection
    from .services import _shopify_resync_on, shopify_resync_available

    org_ids = [
        org.id
        for org in Organization.objects.filter(shopify_resync_orders=True)
        if shopify_resync_available(org)
    ]
    for connection in ShopifyConnection.all_objects.filter(organization_id__in=org_ids, is_connected=True):
        if not _shopify_resync_on(connection.organization_id):
            continue
        try:
            ensure_oms_order_webhooks(connection)
        except shopify_client.ShopifyAPIError as exc:
            # Mostly an expired connector token - retried next round.
            logger.info("shopify webhook check: %s not reachable yet - %s", connection.shop_domain, str(exc)[:120])
        except Exception:
            logger.exception("shopify webhook check failed for %s", connection.shop_domain)


def start_background_check():
    """Idempotent - only the first call starts the thread."""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, name="shopify-webhook-check", daemon=True).start()
    logger.info("shopify webhook check started")


def _loop():
    from django.conf import settings
    from django.db import close_old_connections

    while True:
        try:
            close_old_connections()
            check_resync_stores()
        except Exception:
            logger.exception("shopify webhook check round failed")
        time.sleep(settings.SHOPIFY_WEBHOOK_CHECK_INTERVAL_SECONDS)
