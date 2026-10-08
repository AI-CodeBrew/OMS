"""Background thread that periodically syncs PostEx shipment statuses - the
only way statuses arrive automatically, since PostEx has no webhooks. Own
module with its own start guard, so its lifecycle never interacts with the
Smartlane or BarqRaftar pollers. Started from IntegrationsConfig.ready(),
gated behind the POSTEX_AUTO_POLL setting (see config/settings/base.py)."""

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
    thread = threading.Thread(target=_poll_loop, name="postex-poller", daemon=True)
    thread.start()
    logger.info("postex background poller started")


def _poll_loop():
    from django.conf import settings
    from django.db import close_old_connections, connections

    from .exceptions import PostExAPIError
    from .models import PostExConnection
    from .services import poll_postex_statuses

    interval = settings.POSTEX_AUTO_POLL_INTERVAL_SECONDS
    while True:
        try:
            close_old_connections()
            org_ids = list(
                PostExConnection.all_objects.filter(is_connected=True).values_list("organization_id", flat=True)
            )
            for org_id in org_ids:
                try:
                    result = poll_postex_statuses(org_id)
                    logger.info("postex auto-poll org=%s checked=%s updated=%s",
                                org_id, result.get("checked"), result.get("updated"))
                except PostExAPIError:
                    logger.exception("postex auto-poll failed for org %s", org_id)
                except Exception:
                    logger.exception("postex auto-poll unexpected error for org %s", org_id)
        except Exception:
            logger.exception("postex auto-poll loop iteration failed")
        finally:
            # Hand the DB connection back before sleeping - the pool is
            # small (see config/settings/base.py), same as BarqRaftar's.
            connections.close_all()
        time.sleep(interval)
