"""Background thread that periodically syncs BarqRaftar shipment statuses -
exact counterpart to integrations/poller.py (Smartlane), kept in its own
module with its own start guard so this thread's lifecycle can never
interact with Smartlane's. Started from IntegrationsConfig.ready(), gated
behind the BARQRAFTAR_AUTO_POLL setting (see config/settings/base.py)."""

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
    thread = threading.Thread(target=_poll_loop, name="barqraftar-poller", daemon=True)
    thread.start()
    logger.info("barqraftar background poller started")


def _poll_loop():
    from django.conf import settings
    from django.db import close_old_connections, connections

    from .client import BarqRaftarAPIError
    from .models import BarqRaftarConnection
    from .services import poll_barqraftar_statuses

    interval = settings.BARQRAFTAR_AUTO_POLL_INTERVAL_SECONDS
    while True:
        try:
            close_old_connections()
            connections_qs = list(BarqRaftarConnection.all_objects.filter(is_connected=True))
            for connection in connections_qs:
                try:
                    result = poll_barqraftar_statuses(connection.organization_id)
                    logger.info(
                        "barqraftar auto-poll org=%s checked=%s updated=%s",
                        connection.organization_id, result.get("checked"), result.get("updated"),
                    )
                except BarqRaftarAPIError:
                    logger.exception(
                        "barqraftar auto-poll failed for org %s", connection.organization_id
                    )
                except Exception:
                    logger.exception(
                        "barqraftar auto-poll unexpected error for org %s", connection.organization_id
                    )
        except Exception:
            logger.exception("barqraftar auto-poll loop iteration failed")
        finally:
            # Unlike Smartlane's poller (integrations/poller.py), which
            # only calls close_old_connections() at the top of each loop,
            # this releases the connection back to the pool before
            # sleeping - the pool caps at 10 connections (see
            # config/settings/base.py) and a long-lived thread holding one
            # the whole time it sleeps is one fewer available to real
            # requests.
            connections.close_all()
        time.sleep(interval)
