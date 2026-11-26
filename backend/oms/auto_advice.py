"""Auto Shipper Advice (user, 2026-11-26): every Undelivered order whose
courier has opened it for advice - the green "Open for advice" (PostEx
"Delivery Under Review", BarqRaftar "Return Confirmation", Leopards an open
request; services.advice_open_map) - gets "Reattempt" with REMARKS, by
itself, whatever the courier's reason.

Switched on per store, and for every Dispatch Hub store at once, in Critical
Orders > Shipper Advice Needed (Organization.auto_shipper_advice; the hidden
platform organization's flag is the Hub's). A background thread checks every
AUTO_SHIPPER_ADVICE_INTERVAL_SECONDS (5 min).

AUTO_SHIPPER_ADVICE_MODE (settings):
- "dry_run" (default): nothing is sent - each order it would send is logged
  once per stay in Undelivered (AutoAdviceLog "would_send"), to be checked
  before going live (user asked for a dry run first).
- "live": sent through services.set_shipper_advice - exactly what the Shipper
  Advice button does, so the courier's refusal saves nothing. A refusal is
  logged and tried again only after RETRY_AFTER.
- "off": the thread doesn't start.
"""

import logging
import threading
import time
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Max
from django.utils import timezone

logger = logging.getLogger(__name__)

ADVICE = "Reattempt"
REMARKS = "Please re-attempt. Call the customer before delivery."
# A refused / failed send is tried again after this long (the courier may
# have opened it again by then).
RETRY_AFTER = timedelta(hours=6)
# Orders handled per run - the rest wait for the next one.
MAX_PER_RUN = 200
# The first run waits this long after the server starts.
START_DELAY_SECONDS = 60
PKT = ZoneInfo("Asia/Karachi")


def mode():
    value = (getattr(settings, "AUTO_SHIPPER_ADVICE_MODE", "dry_run") or "").strip().lower()
    return value if value in ("dry_run", "live", "off") else "dry_run"


# -- Switches -------------------------------------------------------------

def platform_organization():
    from core.models import Organization

    return Organization.objects.filter(is_platform=True).first()


def hub_enabled():
    from core.models import Organization

    return Organization.objects.filter(is_platform=True, auto_shipper_advice=True).exists()


def enabled_organization_ids():
    """Stores whose orders get auto advice: their own switch on, or in the
    Dispatch Hub while the Hub's switch is on."""
    from core.dispatch_hub_service import active_hub_organization_ids
    from core.models import Organization

    ids = {
        str(i) for i in Organization.objects.filter(
            auto_shipper_advice=True, is_platform=False, is_active=True,
        ).values_list("id", flat=True)
    }
    if hub_enabled():
        ids |= {str(i) for i in active_hub_organization_ids()}
    return ids


def store_in_hub(organization_id):
    from core.models import DispatchHubStore

    return DispatchHubStore.objects.filter(organization_id=organization_id).exists()


# -- One run --------------------------------------------------------------

def _entered_undelivered(order_ids):
    from .models import OrderStatusEvent

    return dict(
        OrderStatusEvent.all_objects.filter(order_id__in=order_ids, to_status="attempt")
        .exclude(from_status="attempt")
        .values("order_id")
        .annotate(at=Max("created_at"))
        .values_list("order_id", "at")
    )


def _skip_reason(order, last_log, entered, run_mode, now):
    """Why this open order isn't handled in this run, or None."""
    if not last_log:
        return None
    since = entered.get(order.id) or order.created_at
    if last_log.created_at < since:
        return None  # from an earlier stay in Undelivered
    if run_mode == "dry_run" and last_log.result == last_log.RESULT_WOULD_SEND:
        return "already in the dry-run log"
    if last_log.result in (last_log.RESULT_REFUSED, last_log.RESULT_ERROR) and now - last_log.created_at < RETRY_AFTER:
        return "refused recently"
    return None


def open_orders(org_ids):
    """The orders auto advice would answer now: in Shipper Advice Needed
    for those stores AND open for advice by the courier's own status."""
    from . import services
    from .models import Order

    if not org_ids:
        return []
    qs = services.CRITICAL_REASON_FILTERS["shipper_advice"](
        Order.all_objects.filter(organization_id__in=list(org_ids))
    )
    orders = list(qs.select_related("courier")[: MAX_PER_RUN * 2])
    advice = services.advice_open_map(orders)
    return [o for o in orders if (advice.get(str(o.id)) or {}).get("open")]


def _log(order, result, courier="", message=""):
    from .models import AutoAdviceLog

    return AutoAdviceLog.all_objects.create(
        organization_id=order.organization_id, order=order, courier=courier or "",
        advice=ADVICE, result=result, message=(message or "")[:500],
    )


def _courier_name(order):
    return (order.courier.name or "").strip() if order.courier_id and order.courier else ""


def _send(order):
    """Live: Reattempt through the same path as the Shipper Advice button.
    Returns (result, message)."""
    from core.context import tenant_context

    from . import services
    from .models import AutoAdviceLog, Order, OrderStatusEvent

    with tenant_context(order.organization_id):
        with transaction.atomic():
            # Another runner (or a person) on the same order at the same
            # moment: only one goes ahead.
            with connection.cursor() as cursor:
                cursor.execute("select pg_try_advisory_xact_lock(%s)", [int(order.id.hex[:15], 16)])
                if not cursor.fetchone()[0]:
                    return None, "busy"
            fresh = Order.all_objects.select_related("courier").get(id=order.id)
            state = services.advice_open_map([fresh]).get(str(fresh.id)) or {}
            if not state.get("open"):
                return None, "not open any more"
            try:
                services.set_shipper_advice(fresh, advice=ADVICE, remarks=REMARKS, actor_user_id=None, auto=True)
            except services.InvalidTransition as exc:
                OrderStatusEvent.all_objects.create(
                    organization_id=fresh.organization_id, order=fresh,
                    from_status=fresh.status, to_status=fresh.status,
                    note=f"Auto Shipper Advice (Reattempt) not accepted: {exc}"[:1000],
                )
                return AutoAdviceLog.RESULT_REFUSED, str(exc)
    return AutoAdviceLog.RESULT_SENT, REMARKS


def run_once(run_mode=None):
    """One check over every switched-on store. Returns a summary."""
    from .models import AutoAdviceLog

    run_mode = run_mode or mode()
    summary = {"mode": run_mode, "stores": 0, "open": 0, "would_send": 0, "sent": 0, "refused": 0,
               "errors": 0, "skipped": 0}
    if run_mode == "off":
        return summary
    org_ids = enabled_organization_ids()
    summary["stores"] = len(org_ids)
    orders = open_orders(org_ids)
    summary["open"] = len(orders)
    if not orders:
        return summary
    ids = [o.id for o in orders]
    entered = _entered_undelivered(ids)
    last = {}
    for row in AutoAdviceLog.all_objects.filter(order_id__in=ids).order_by("order_id", "-created_at"):
        last.setdefault(row.order_id, row)
    now = timezone.now()
    handled = 0
    for order in orders:
        if handled >= MAX_PER_RUN:
            break
        if _skip_reason(order, last.get(order.id), entered, run_mode, now):
            summary["skipped"] += 1
            continue
        handled += 1
        courier = _courier_name(order)
        try:
            if run_mode == "dry_run":
                _log(order, AutoAdviceLog.RESULT_WOULD_SEND, courier, REMARKS)
                summary["would_send"] += 1
                continue
            result, message = _send(order)
            if result is None:
                summary["skipped"] += 1
                continue
            _log(order, result, courier, message)
            summary["sent" if result == AutoAdviceLog.RESULT_SENT else "refused"] += 1
        except Exception as exc:  # noqa: BLE001 - one order must not stop the rest
            logger.exception("auto shipper advice failed for %s", order.order_number)
            summary["errors"] += 1
            try:
                _log(order, AutoAdviceLog.RESULT_ERROR, courier, str(exc))
            except Exception:  # noqa: BLE001
                logger.exception("auto shipper advice: couldn't log the error for %s", order.order_number)
    return summary


# -- Background thread ----------------------------------------------------

_started = False
_lock = threading.Lock()


def start_background_runner():
    """Idempotent - only the first call starts the thread."""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    thread = threading.Thread(target=_loop, name="auto-shipper-advice", daemon=True)
    thread.start()
    logger.info("auto shipper advice runner started (%s)", mode())


def _loop():
    from django.db import close_old_connections, connections

    time.sleep(START_DELAY_SECONDS)
    interval = max(60, int(getattr(settings, "AUTO_SHIPPER_ADVICE_INTERVAL_SECONDS", 300)))
    while True:
        try:
            close_old_connections()
            summary = run_once()
            if summary.get("open") or summary.get("errors"):
                logger.info("auto shipper advice: %s", summary)
        except Exception:
            logger.exception("auto shipper advice run failed")
        finally:
            connections.close_all()
        time.sleep(interval)


# -- Critical Orders > Shipper Advice Needed: the switch and its log ------

def status_for(*, scope, organization_ids, limit=50):
    """What the switch bar shows: {scope, enabled, hub_on, mode, interval_minutes,
    today: {sent, would_send, refused}, log: [...]}. scope "store" (one
    store), "hub" (the Dispatch Hub) or None (no switch here)."""
    from core.models import Organization

    from .models import AutoAdviceLog

    out = {
        "scope": scope, "enabled": False, "hub_on": False, "mode": mode(),
        "interval_minutes": max(1, int(getattr(settings, "AUTO_SHIPPER_ADVICE_INTERVAL_SECONDS", 300)) // 60),
        "advice": ADVICE, "remarks": REMARKS, "today": {}, "log": [],
    }
    if not scope or not organization_ids:
        return out
    if scope == "hub":
        out["enabled"] = hub_enabled()
    else:
        org_id = organization_ids[0]
        out["enabled"] = Organization.objects.filter(id=org_id, auto_shipper_advice=True).exists()
        out["hub_on"] = hub_enabled() and store_in_hub(org_id)
    logs = AutoAdviceLog.all_objects.filter(organization_id__in=organization_ids)
    # "Today" in Pakistan time (the server runs in UTC).
    start = timezone.now().astimezone(PKT).replace(hour=0, minute=0, second=0, microsecond=0)
    for result in ("sent", "would_send", "refused"):
        out["today"][result] = logs.filter(created_at__gte=start, result=result).count()
    names = dict(Organization.objects.filter(id__in=organization_ids).values_list("id", "name"))
    for row in logs.select_related("order").order_by("-created_at")[:limit]:
        out["log"].append({
            "order_id": str(row.order_id),
            "order_number": row.order.order_number if row.order_id else "",
            "store": names.get(row.organization_id, ""),
            "courier": row.courier,
            "advice": row.advice,
            "result": row.result,
            "message": row.message,
            "at": row.created_at.isoformat(),
        })
    return out


def set_switch(*, scope, organization_id, enabled, actor_user_id=None, actor_email=""):
    """Turns auto advice on/off for one store, or the Dispatch Hub (the
    platform organization's flag). Logged in the store's activity log."""
    from core.models import Organization, OrganizationAuditLog

    if scope == "hub":
        org = platform_organization()
        if org is None:
            raise ValueError("The Dispatch Hub isn't set up (no platform organization).")
        where = "Dispatch Hub"
    else:
        org = Organization.objects.filter(id=organization_id).first()
        if org is None:
            raise ValueError("Store not found.")
        where = org.name
    enabled = bool(enabled)
    if org.auto_shipper_advice != enabled:
        org.auto_shipper_advice = enabled
        org.save(update_fields=["auto_shipper_advice", "updated_at"])
        try:
            OrganizationAuditLog.all_objects.create(
                organization_id=org.id, actor_user_id=actor_user_id, actor_email=actor_email or "",
                actor_role=OrganizationAuditLog.ROLE_SUPER_ADMIN if scope == "hub" else OrganizationAuditLog.ROLE_STORE_ADMIN,
                action="orders.auto_shipper_advice", category="orders", entity_type="organization",
                entity_id=str(org.id),
                summary=f"Auto Shipper Advice (Reattempt) turned {'on' if enabled else 'off'} - {where}",
                metadata={"enabled": enabled, "scope": scope},
            )
        except Exception:  # noqa: BLE001 - the switch itself matters, the log is a nicety
            logger.exception("auto shipper advice: couldn't write the audit log")
    return enabled
