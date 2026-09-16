"""Background thread that periodically syncs Smartlane statuses, so orders
advance (and orders booked directly on Smartlane's own portal get noticed
at all) without anyone clicking "Sync" by hand.

No Celery/broker exists in this codebase (see integrations.services.
run_shopify_sync's docstring for the same reasoning), so this uses a plain
daemon thread - started once from IntegrationsConfig.ready(), gated behind
the SMARTLANE_AUTO_POLL setting so it only ever runs on the real deployed
server (see that setting's comment in config/settings/base.py).
"""

import logging
import threading
import time

logger = logging.getLogger(__name__)

_started = False
_lock = threading.Lock()


def start_background_poller():
    """Idempotent - safe to call more than once, only the first call
    actually starts the thread."""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    thread = threading.Thread(target=_poll_loop, name="smartlane-poller", daemon=True)
    thread.start()
    logger.info("smartlane background poller started")


def _poll_loop():
    from django.conf import settings
    from django.db import close_old_connections

    from .models import SmartlaneConnection
    from .services import poll_smartlane_statuses
    from .smartlane_client import SmartlaneAPIError

    interval = settings.SMARTLANE_AUTO_POLL_INTERVAL_SECONDS
    while True:
        try:
            # This thread never goes through Django's normal request/response
            # cycle, which is what usually recycles connections - without
            # this, connections accumulate/go stale over a long-lived loop.
            close_old_connections()
            connections = list(SmartlaneConnection.all_objects.filter(is_connected=True))
            for connection in connections:
                try:
                    result = poll_smartlane_statuses(connection.organization_id)
                    logger.info(
                        "smartlane auto-poll org=%s checked=%s updated=%s",
                        connection.organization_id, result.get("checked"), result.get("updated"),
                    )
                except SmartlaneAPIError:
                    logger.exception(
                        "smartlane auto-poll failed for org %s", connection.organization_id
                    )
                except Exception:
                    logger.exception(
                        "smartlane auto-poll unexpected error for org %s", connection.organization_id
                    )
        except Exception:
            logger.exception("smartlane auto-poll loop iteration failed")
        time.sleep(interval)
