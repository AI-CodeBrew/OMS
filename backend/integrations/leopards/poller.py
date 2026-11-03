"""Background thread that periodically syncs Leopards shipment statuses - the
backup behind Leopards' Push API webhook (views.leopards_webhook), catching
any push Leopards misses or a registration that isn't set up yet. Own module
with its own start guard, so its lifecycle never interacts with the
Smartlane, BarqRaftar or PostEx pollers. Started from
IntegrationsConfig.ready(), gated behind the LEOPARDS_AUTO_POLL setting (see
config/settings/base.py)."""

import logging
import threading
import time

logger = logging.getLogger(__name__)

_started = False
_lock = threading.Lock()


def start_background_poller():
    """Idempotent - only the first call actually starts the thread."""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    thread = threading.Thread(target=_poll_loop, name="leopards-poller", daemon=True)
    thread.start()
    logger.info("leopards background poller started")


def _poll_loop():
    from django.conf import settings
    from django.db import close_old_connections, connections

    from .exceptions import LeopardsAPIError
    from .models import LeopardsConnection
    from .services import poll_leopards_statuses

    interval = settings.LEOPARDS_AUTO_POLL_INTERVAL_SECONDS
    while True:
        try:
            close_old_connections()
            org_ids = list(
                LeopardsConnection.all_objects.filter(is_connected=True).values_list("organization_id", flat=True)
            )
            for org_id in org_ids:
                try:
                    result = poll_leopards_statuses(org_id)
                    logger.info("leopards auto-poll org=%s checked=%s updated=%s",
                                org_id, result.get("checked"), result.get("updated"))
                except LeopardsAPIError:
                    logger.exception("leopards auto-poll failed for org %s", org_id)
                except Exception:
                    logger.exception("leopards auto-poll unexpected error for org %s", org_id)
        except Exception:
            logger.exception("leopards auto-poll loop iteration failed")
        finally:
            # Hand the DB connection back before sleeping - the pool is
            # small (see config/settings/base.py), same as PostEx's.
            connections.close_all()
        time.sleep(interval)
