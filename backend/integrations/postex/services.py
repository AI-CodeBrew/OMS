"""Domain logic for the PostEx integration - booking, city matching, status
mapping, the poller's body, the manual "Sync now" runner and
cancel-with-courier.

Same structure as integrations/barqraftar/services.py but shares no code
with it (or with Smartlane's integrations/services.py): nothing here imports
either, and neither imports this. Where the same *shape* of logic is needed
(catching an order up to Dispatched before applying a later status), it's a
small local copy. Everything goes through PUBLIC oms.services functions
(book_with_courier, advance_booking_confirmed, mark_returned_by_courier,
cancel_order, ...).

Statuses arrive two ways: PostEx's status webhook (configured by the
merchant on PostEx's portal - not in their API guide - see
handle_webhook_event below), and, as the backup for any call PostEx
misses, the background poller (postex/poller.py, gated by POSTEX_AUTO_POLL)
plus the integration page's "Sync now" - both run poll_postex_statuses.
"""

import logging
import re
import time
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.db.utils import OperationalError
from django.utils import timezone

from core.context import tenant_context
from core.events import publish_event
from core.platform_service import (
    is_platform_organization,
    platform_organization_id,
    platform_reference,
)

from . import client
from .exceptions import PostExAPIError, PostExBookingError
from .models import PostExConnection, PostExShipment, PostExSyncJob

logger = logging.getLogger(__name__)

# Local copy of the OMS statuses a courier can no longer move - same three as
# BarqRaftar's/Smartlane's own copies, deliberately not imported.
TERMINAL_STATUSES = {"delivered", "returned", "cancelled"}

COURIER_NAME = "PostEx"


# -------------------------------------------------------- Status mapping --
# PostEx reports an order's status as TEXT, in two different vocabularies
# depending on the endpoint (both confirmed live, 2026-10-08):
#   /track-order, /track-bulk-order    /get-all-order (Shipments list)
#   "Unbooked"                         "Unbooked"
#   "Booked"                           "Booked"
#   "PostEx WareHouse"                 "In Stock"
#   "En-Route to <City> warehouse"     "Transferred"
#   "Out For Delivery"                 "Delivery En-Route"
#   "Attempted"                        "Attempted"
#   "Delivery Under Review"            "Under Verification"
#   "Out For Return"                   "Return In-Transit"
#   "Returned"                         "Return"
#   "Delivered"                        "Delivered"
# plus the guide's own list ("Picked By PostEx", "Un-Assigned By Me",
# "Expired", "Return Requested", ...). Both spellings map to the same stage
# here. Only ever moves an OMS order forward - see apply_postex_status.

_STAGE_BY_STATUS = {
    "unbooked": "pending",
    "booked": "pending",
    "picked by postex": "dispatched",
    "postex warehouse": "dispatched",
    "in stock": "dispatched",
    "transferred": "dispatched",
    "en-route to postex warehouse": "dispatched",
    "out for delivery": "out_for_delivery",
    "delivery en-route": "out_for_delivery",
    "attempted": "attempt",
    "delivery under review": "attempt",
    "under verification": "attempt",
    "out for return": "return_in_progress",
    "return in-transit": "return_in_progress",
    "return in transit": "return_in_progress",
    "return requested": "return_in_progress",
    "returned": "returned",
    "return": "returned",
    "delivered": "delivered",
    "un-assigned by me": "cancelled",
    "cancelled": "cancelled",
    "canceled": "cancelled",
}

# Fallback when the status text is one we've never seen: the newest
# transactionStatusHistory code (also confirmed live - the guide only lists
# 0001-0013, real histories also carry 0031-0040).
_STAGE_BY_HISTORY_CODE = {
    "0003": "dispatched",  # Received at <hub> Warehouse
    "0031": "dispatched",  # Departed to PostEx. Warehouse
    "0033": "dispatched",  # Departed to <city>
    "0035": "dispatched",  # Arrived at Transit Hub <hub>
    "0038": "dispatched",  # Waiting for Delivery
    "0004": "out_for_delivery",  # Enroute for Delivery
    "0013": "attempt",  # Attempt Made: <reason>
    "0008": "attempt",  # Delivery Under Review / Merchant Request For Return
    "0005": "delivered",  # Delivered to Customer
    "0039": "return_in_progress",  # Waiting for Return
    "0040": "return_in_progress",  # Return Process Initiated
    "0037": "return_in_progress",  # Return to <city>
    "0032": "return_in_progress",  # En Route to Merchant Warehouse
    "0006": "returned",  # Returned at Merchant Warehouse
}

# PostEx stages from which our own cancel still asks PostEx to cancel
# (anything later means the parcel is already with PostEx).
_CANCELLABLE_STAGES = {"pending"}


def _normalize_status(label):
    return re.sub(r"\s+", " ", str(label or "").strip().lower())


def status_stage(label, history=None):
    """PostEx status text (+ its history, as a fallback) -> one of pending /
    dispatched / out_for_delivery / attempt / return_in_progress / returned
    / delivered / cancelled, or None if it can't be told."""
    normalized = _normalize_status(label)
    stage = _STAGE_BY_STATUS.get(normalized)
    if stage:
        return stage
    # "En-Route to Lahore warehouse" - the city is filled in per parcel.
    if normalized.startswith("en-route to") or normalized.startswith("at postex"):
        return "dispatched"
    for entry in reversed(history or []):
        if isinstance(entry, dict):
            stage = _STAGE_BY_HISTORY_CODE.get(str(entry.get("transactionStatusMessageCode") or ""))
            if stage:
                return stage
    return None


# --------------------------------------------------------------- Helpers --

def _normalize_phone(phone):
    """Pakistani mobile number -> "03XXXXXXXXX" (PostEx's documented
    customerPhone format), or None if it can't be made into one."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("0092"):
        digits = digits[4:]
    elif digits.startswith("92") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("3"):
        return "0" + digits
    if len(digits) == 11 and digits.startswith("03"):
        return digits
    return None


# ----------------------------------------------------------- City match --

# Short forms staff actually type/import that a plain name match would miss.
# Targets are PostEx's own city names (checked against the live list).
# Deliberately small and literal - no fuzzy matching, since a wrong
# auto-match would send a parcel to the wrong city.
_BUILT_IN_CITY_ALIASES = {
    "isb": "islamabad",
    "pindi": "rawalpindi",
    "rwp": "rawalpindi",
    "rawalpindi cantt": "rawalpindi",
    "khi": "karachi",
    "lhr": "lahore",
    "lhe": "lahore",
    "fsd": "faisalabad",
    "mux": "multan",
    "pew": "peshawar",
    "hyd": "hyderabad",
    "qta": "quetta",
    "skt": "sialkot",
    "grw": "gujranwala",
    "wah": "wah cantt",
    "wah cantonment": "wah cantt",
    "dg khan": "dera ghazi khan",
    "d g khan": "dera ghazi khan",
    "di khan": "dera ismail khan",
    "d i khan": "dera ismail khan",
    "ryk": "rahim yar khan",
    "muzaffarabad": "muzaffarabad ajk",
    "mirpur ajk": "mirpur ajk",
    "mirpur azad kashmir": "mirpur ajk",
}


def _normalize_city_name(name):
    cleaned = re.sub(r"[^a-z0-9]+", " ", (name or "").strip().lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def get_cities(connection, *, force_refresh=False):
    """PostEx's delivery cities as a list of names, refreshed from their API
    if the cache is empty or older than 24h. Raises PostExAPIError if a
    refresh was needed and failed - callers must not read that as "no
    cities" (book_orders calls this once upfront for exactly that reason)."""
    stale = (
        force_refresh
        or not connection.cities_cache
        or not connection.cities_cached_at
        or (timezone.now() - connection.cities_cached_at) > timedelta(hours=24)
    )
    if not stale:
        return connection.cities_cache

    rows = client.fetch_operational_cities(connection.api_token)
    seen = set()
    cities = []
    for row in rows:
        if not isinstance(row, dict) or row.get("isDeliveryCity") is False:
            continue
        name = str(row.get("operationalCityName") or "").strip()
        key = _normalize_city_name(name)
        # "WAH CANTT" and "WAH CANTT." normalise to the same key - keep one.
        if not name or key in seen:
            continue
        seen.add(key)
        cities.append(name)

    connection.cities_cache = cities
    connection.cities_cached_at = timezone.now()
    connection.save(update_fields=["cities_cache", "cities_cached_at", "updated_at"])
    return cities


def resolve_city(connection, city_name):
    """Normalised exact match of `city_name` against the cached PostEx city
    list, trying the connection's own aliases first, then the built-in ones.
    Returns PostEx's own spelling (what create-order's cityName must be) or
    None. Never makes a network call itself."""
    cities = connection.cities_cache or []
    normalized = _normalize_city_name(city_name)
    if not cities or not normalized:
        return None
    alias_target = (connection.city_aliases or {}).get(normalized) or _BUILT_IN_CITY_ALIASES.get(normalized)
    lookup = _normalize_city_name(alias_target) if alias_target else normalized
    for name in cities:
        if _normalize_city_name(name) == lookup:
            return name
    return None


# ------------------------------------------------------------- Payload --

def _cod_amount(order):
    """COD is only collected for orders genuinely paid cash-on-delivery -
    same rule as BarqRaftar's _cod_amount (amount_receivable alone isn't a
    safe signal: Shopify orders never populate amount_paid)."""
    if order.payment_gateway == "cod":
        return int(round(order.amount_receivable))
    return 0


def _order_detail(order):
    """"2 x Shirt, 1 x Cap" - PostEx prints this on the airway bill."""
    parts = [f"{item.quantity} x {item.product_name}" for item in order.items.all()]
    detail = ", ".join(parts) or order.order_number
    return detail[:500]


def _piece_count(order):
    return sum(item.quantity for item in order.items.all()) or 1


# ------------------------------------------------------ Booking accounts --
# Same arrangement as BarqRaftar's (see its services.py): a store's orders
# book through its own PostEx account - or, from the Dispatch Hub, through
# FynkTech's own (the super admin's OMS Couriers tab, held by the platform
# org - core.platform_service). Order.platform_reference marks such a
# booking, so tracking, printing, cancelling, the poller and the webhook
# all use FynkTech's account for it.

def platform_connection():
    """FynkTech's own connected PostEx account, or None."""
    return PostExConnection.all_objects.filter(
        organization_id=platform_organization_id(), is_connected=True
    ).first()


def connection_for_order(order):
    """The connected account `order` was booked through."""
    if order.platform_reference:
        return platform_connection()
    return PostExConnection.all_objects.filter(
        organization_id=order.organization_id, is_connected=True
    ).first()


def connection_for_request(request):
    """The account a request acts on: FynkTech's own while operating the
    Dispatch Hub (every Hub booking goes through it), else the store's."""
    if getattr(request, "organization_ids", None):
        return platform_connection()
    return PostExConnection.objects.filter(
        organization_id=request.organization_id, is_connected=True
    ).first()


def _shipments_for(connection):
    """Active shipments booked through `connection`: the store's own - or,
    for FynkTech's account, every Hub booking made through it, whichever
    store's order it is."""
    qs = PostExShipment.all_objects.filter(is_active=True)
    if is_platform_organization(connection.organization_id):
        return qs.exclude(order__platform_reference="")
    return qs.filter(organization_id=connection.organization_id, order__platform_reference="")


def _next_reference(order, *, via_platform=False):
    """order.order_number (without '#'), or -R2/-R3/... if an earlier,
    since-cancelled booking already used the plain form - the old shipment
    row stays as history and is never reused. Through FynkTech's account it
    carries the store code in front (core.platform_service.
    platform_reference)."""
    base = order.order_number.lstrip("#") or order.order_number
    if via_platform:
        base = platform_reference(order, base)
    existing = set(
        PostExShipment.all_objects.filter(organization_id=order.organization_id, order=order)
        .values_list("reference", flat=True)
    )
    if base not in existing:
        return base
    n = 2
    while f"{base}-R{n}" in existing:
        n += 1
    return f"{base}-R{n}"


def _build_order_payload(order, connection, city_name, reference):
    phone = _normalize_phone(order.customer_phone) or _normalize_phone(order.secondary_phone)
    if not phone:
        raise PostExBookingError(
            f"Order {order.order_number}: customer phone {order.customer_phone!r} "
            "isn't a valid Pakistani mobile number - fix it before booking."
        )
    address = " ".join(p for p in [order.address_line1, order.address_line2] if p).strip()
    if not address:
        raise PostExBookingError(f"Order {order.order_number} has no shipping address.")

    payload = {
        "orderRefNumber": reference,
        # A string per the guide; PostEx stores it as the COD amount.
        "invoicePayment": str(_cod_amount(order)),
        "orderDetail": _order_detail(order),
        "customerName": (order.customer_name or "Customer")[:100],
        "customerPhone": phone,
        "deliveryAddress": address[:500],
        "transactionNotes": connection.default_notes or "",
        "cityName": city_name,
        "invoiceDivision": 1,
        "items": _piece_count(order),
        "orderType": connection.default_order_type or "Normal",
    }
    if connection.pickup_address_code:
        payload["pickupAddressCode"] = connection.pickup_address_code
    return payload


# --------------------------------------------------------------- Booking --

def book_orders(organization_id, order_ids, *, actor_user_id=None, force=False, via_platform=False):
    """Books one or many orders with PostEx - the handler behind "Book with
    PostEx" (oms/views.py's bulk_action special-cases action="push_to_postex"
    and calls this directly). PostEx has no bulk create, so each order is
    its own create-order call; PostEx answers with a tracking number
    immediately, so a booked order goes straight to Ready to Print.

    Returns [{"order_id", "order_number", "success", "error"?, "error_code"?,
    "shortages"?}] - the same shape as oms/views.py's generic bulk-action
    loop, so the stock-shortage modal and its force-retry work unchanged.

    via_platform books through FynkTech's own account instead of the
    store's - the Dispatch Hub's bookings (see "Booking accounts" above)."""
    from oms.models import Courier, Order
    from wms import services as wms_services

    orders_by_id = {
        str(o.id): o
        for o in Order.objects.filter(organization_id=organization_id, id__in=order_ids).prefetch_related("items")
    }

    if via_platform:
        connection = platform_connection()
        not_connected = "Connect FynkTech's PostEx account on the super admin's OMS Couriers tab first."
    else:
        connection = PostExConnection.objects.filter(organization_id=organization_id, is_connected=True).first()
        not_connected = "Connect PostEx from the Integrations page first."
    if not connection:
        return [{"order_id": str(oid), "success": False, "error": not_connected} for oid in order_ids]
    if not connection.pickup_address_code:
        return [
            {"order_id": str(oid), "success": False,
             "error": "Set an active pickup address on the PostEx integration page first."}
            for oid in order_ids
        ]

    try:
        get_cities(connection)
    except PostExAPIError as exc:
        return [
            {"order_id": str(oid), "success": False, "error": f"Could not load PostEx cities: {exc}"}
            for oid in order_ids
        ]

    courier = None
    results = []

    for order_id in order_ids:
        order = orders_by_id.get(str(order_id))
        if not order:
            results.append({"order_id": str(order_id), "success": False, "error": "Not found"})
            continue
        base = {"order_id": str(order_id), "order_number": order.order_number}

        if order.status != "awaiting_assigning":
            results.append({
                **base, "success": False,
                "error": f"Order {order.order_number} is {order.get_status_display()}, not Awaiting Assigning.",
            })
            continue

        city_name = resolve_city(connection, order.city)
        if city_name is None:
            # Left in Awaiting Assigning (same choice as BarqRaftar) - add an
            # alias on the Cities tab, or book it with another courier.
            results.append({
                **base, "success": False,
                "error": (
                    f"PostEx doesn't recognise the city {order.city!r} - order left in Awaiting "
                    "Assigning. Add a city alias on the PostEx Cities tab, or book it with another courier."
                ),
            })
            continue

        shortages = wms_services.check_order_stock(order)
        if shortages and not force:
            results.append({
                **base, "success": False,
                "error": str(wms_services.InsufficientStock(shortages)),
                "error_code": "insufficient_stock", "shortages": shortages,
            })
            continue

        try:
            reference = _next_reference(order, via_platform=via_platform)
            payload = _build_order_payload(order, connection, city_name, reference)
        except PostExBookingError as exc:
            results.append({**base, "success": False, "error": str(exc)})
            continue

        try:
            dist = client.create_order(connection.api_token, payload)
        except PostExAPIError as exc:
            results.append({**base, "success": False, "error": f"PostEx booking failed: {exc}"})
            continue

        tracking_number = str(dist.get("trackingNumber") or "").strip()
        if not tracking_number:
            results.append({
                **base, "success": False,
                "error": "PostEx accepted the order but returned no tracking number - check the PostEx portal "
                         "before booking it again.",
            })
            continue

        if courier is None:
            courier = Courier.objects.filter(organization_id=organization_id, name__iexact=COURIER_NAME).first()
            if courier is None:
                courier = Courier.objects.create(organization_id=organization_id, name=COURIER_NAME, is_active=True)

        try:
            _finalize_booking(
                order, reference=reference, tracking_number=tracking_number, courier=courier,
                connection=connection, status_label=str(dist.get("orderStatus") or "Unbooked"),
                actor_user_id=actor_user_id, via_platform=via_platform,
            )
            results.append({**base, "success": True})
        except Exception as exc:  # noqa: BLE001 - one order's failure must not lose the rest
            logger.exception("postex: finalize booking failed for %s", order.order_number)
            results.append({
                **base, "success": False,
                "error": (
                    f"Booked with PostEx (tracking {tracking_number}) but failed to update the order "
                    f"locally: {exc}. Use Sync now to reconcile."
                ),
            })

    return results


def _finalize_booking(order, *, reference, tracking_number, courier, connection, status_label, actor_user_id,
                      via_platform=False):
    """Saves the shipment row FIRST, so a failure in the local transition
    below never loses the tracking number. Then moves the order through
    Booking Pending to Ready to Print in one atomic block."""
    from oms import services as oms_services

    PostExShipment.all_objects.create(
        organization_id=order.organization_id,
        order=order,
        reference=reference,
        tracking_number=tracking_number,
        status_label=status_label,
        pickup_address_code=connection.pickup_address_code,
        is_active=True,
    )
    # Which account the order belongs to from here on - see "Booking
    # accounts" above. Cleared for a store-account booking, in case an
    # earlier, since-cancelled one went through FynkTech's.
    order.platform_reference = reference if via_platform else ""
    order.save(update_fields=["platform_reference", "updated_at"])
    with transaction.atomic():
        order = oms_services.book_with_courier(
            order, courier_id=courier.id, tracking_number=tracking_number, actor_user_id=actor_user_id,
        )
        oms_services.advance_booking_confirmed(order, actor_user_id=actor_user_id)
    return order


def mark_load_sheet_generated(shipments):
    PostExShipment.all_objects.filter(id__in=[s.id for s in shipments]).update(load_sheet_at=timezone.now())


# --------------------------------------------------------------- Cancel --

def cancel_on_postex(order):
    """Asks PostEx to cancel the live consignment for `order`. Raises
    PostExBookingError if PostEx already has the parcel (or refuses / can't
    be reached) - oms.services.cancel_order lets that propagate and does NOT
    cancel locally, since a parcel the courier is carrying outranks the
    local screen. No-op if the order has no active PostEx shipment."""
    shipment = PostExShipment.all_objects.filter(
        organization_id=order.organization_id, order=order, is_active=True
    ).first()
    if not shipment or not shipment.tracking_number:
        return

    connection = connection_for_order(order)
    if not connection:
        raise PostExBookingError("PostEx is not connected - cannot confirm whether the shipment can still be cancelled.")

    try:
        row = client.track_order(connection.api_token, shipment.tracking_number)
    except PostExAPIError as exc:
        raise PostExBookingError(f"Could not check PostEx's status before cancelling: {exc}") from exc

    label = str(row.get("transactionStatus") or "")
    stage = status_stage(label, row.get("transactionStatusHistory"))
    if not row or stage == "cancelled":
        return  # PostEx doesn't have it (any more), or it's already cancelled there.
    if stage not in _CANCELLABLE_STAGES:
        raise PostExBookingError(
            f"PostEx reports this shipment as {label or 'in progress'} - it can no longer be cancelled."
        )
    try:
        client.cancel_order(connection.api_token, shipment.tracking_number)
    except PostExAPIError as exc:
        raise PostExBookingError(f"PostEx refused to cancel: {exc}") from exc


def release_shipment_stock_and_deactivate(order, *, actor_user_id=None):
    """Puts back the stock booking consumed and deactivates the shipment row
    (a rebook then creates a fresh row - see _next_reference). Called by
    oms.services.cancel_order's PostEx branch. Uses organization_id
    explicitly since this can run from the poller thread, outside any
    request's tenant context."""
    from wms import services as wms_services

    shipments = PostExShipment.all_objects.filter(organization_id=order.organization_id, order=order)
    # An order can carry a courier named "PostEx" without ever having been
    # booked through this integration (CSV import, Shopify fulfillment
    # sync, manual edit) - leave its stock alone, only bookings made here
    # consumed any.
    if not shipments.exists():
        return
    wms_services.release_order_stock(order, actor_user_id=actor_user_id, note="Order cancelled (PostEx)")
    shipments.filter(is_active=True).update(is_active=False, cancelled_at=timezone.now())


# ------------------------------------------------------- Local catch-up --
# Small, deliberate copies of BarqRaftar's helpers of the same name - same
# shape, no shared import. Only PUBLIC oms.services functions.

def _catch_up_to_dispatched(order, tracking_number=""):
    from oms import services as oms_services

    if order.status == "booking_pending":
        if not tracking_number and not order.tracking_number:
            return False
        oms_services.advance_booking_confirmed(order)
    if order.status in ("ready_to_print", "ready_to_pick", "approved", "awaiting_dispatched"):
        oms_services.dispatch_order(order, tracking_number=tracking_number)
    return order.status == "dispatched"


def _advance_to_dispatch_substate(order, target, tracking_number=""):
    from oms import services as oms_services

    if order.status == target:
        return False
    if order.status not in ("dispatched", "out_for_delivery", "attempt"):
        if not _catch_up_to_dispatched(order, tracking_number):
            return False
    if target == "out_for_delivery":
        oms_services.mark_out_for_delivery(order)
    else:
        oms_services.mark_delivery_attempt_failed(order)
    return True


def apply_postex_status(order, stage, *, tracking_number="", actor_user_id=None):
    """Applies one PostEx stage to one order. Only ever moves an order
    forward. Raises oms.services.InvalidTransition for the caller to
    log/skip (a stale/out-of-order status, not a real problem)."""
    from oms import services as oms_services

    if stage == "return_in_progress":
        # Informational, same role as for Smartlane/BarqRaftar.
        if not order.return_in_progress_at:
            order.return_in_progress_at = timezone.now()
            order.save(update_fields=["return_in_progress_at", "updated_at"])
        return False

    if stage == "delivered":
        if order.status == "delivered":
            return False
        _catch_up_to_dispatched(order, tracking_number)
        oms_services.mark_delivered(order)
        return True

    if stage == "returned":
        if order.status == "returned":
            return False
        _catch_up_to_dispatched(order, tracking_number)
        oms_services.mark_returned_by_courier(order, reason="Reported returned by PostEx")
        return True

    if stage == "cancelled":
        if order.status == "cancelled":
            return False
        # PostEx already says it's cancelled - don't call their API again.
        oms_services.cancel_order(
            order, reason="Cancelled on PostEx", actor_user_id=actor_user_id, propagate_to_courier=False,
        )
        return True

    if stage in ("out_for_delivery", "attempt"):
        return _advance_to_dispatch_substate(order, stage, tracking_number)

    if stage == "dispatched":
        if order.status == "dispatched":
            return False
        return _catch_up_to_dispatched(order, tracking_number)

    return False


def _apply_fetched_status(shipment, row):
    """Records one PostEx track row on the shipment, restores a tracking
    number Shopify's own sync may have blanked on the order, self-heals a
    stuck Booking Pending, then applies the status. Returns True if the
    order visibly changed."""
    from oms.models import Order
    from oms import services as oms_services

    order = Order.all_objects.filter(id=shipment.order_id).first()
    if not order or not isinstance(row, dict):
        return False

    label = str(row.get("transactionStatus") or "")
    history = row.get("transactionStatusHistory")
    history = history if isinstance(history, list) else []
    stage = status_stage(label, history)
    before_status = order.status
    filled_tracking = False

    shipment.last_checked_at = timezone.now()
    shipment.last_payload = row
    if label:
        shipment.status_label = label[:100]
    if history:
        shipment.status_history = history
    shipment.save(update_fields=["last_checked_at", "last_payload", "status_label", "status_history", "updated_at"])

    if not order.tracking_number and shipment.tracking_number:
        order.tracking_number = shipment.tracking_number
        order.save(update_fields=["tracking_number", "updated_at"])
        filled_tracking = True
        publish_event(
            "order.updated",
            {
                "organization_id": str(order.organization_id),
                "order_id": str(order.id),
                "order_number": order.order_number,
                "source": "postex",
            },
        )

    if stage is None:
        return filled_tracking

    if order.status == "booking_pending" and shipment.tracking_number:
        try:
            oms_services.advance_booking_confirmed(order)
        except oms_services.InvalidTransition:
            pass

    try:
        apply_postex_status(order, stage, tracking_number=shipment.tracking_number)
    except oms_services.InvalidTransition:
        logger.info("postex: order %s at %s, ignoring %r (stale/out of order)",
                    order.order_number, order.status, label)

    order.refresh_from_db(fields=["status"])
    return filled_tracking or (order.status != before_status)


# --------------------------------------------------------------- Webhook --

# Key names (lowercased, letters only) that may carry a tracking number in
# PostEx's webhook body. PostEx doesn't document that body, so this looks
# for the spellings their API itself uses ("trackingNumber") plus common
# courier variants, anywhere in the payload.
_WEBHOOK_TRACKING_KEYS = {
    "trackingnumber", "trackingnumbers", "trackingno", "tracking",
    "cn", "cnno", "cnnumber", "consignmentno", "consignmentnumber",
}
_WEBHOOK_MAX_NUMBERS = 100


def extract_tracking_numbers(payload):
    """Every tracking number found in a webhook body - a single event, a
    list of events, nested objects, or comma-separated values all work."""
    found = []

    def add(value):
        for part in str(value).split(","):
            part = part.strip()
            if part and part not in found and len(found) < _WEBHOOK_MAX_NUMBERS:
                found.append(part)

    def walk(node, depth):
        if depth > 6 or len(found) >= _WEBHOOK_MAX_NUMBERS:
            return
        if isinstance(node, dict):
            for key, value in node.items():
                if re.sub(r"[^a-z]", "", str(key).lower()) in _WEBHOOK_TRACKING_KEYS:
                    for item in value if isinstance(value, list) else [value]:
                        if isinstance(item, (str, int)) and not isinstance(item, bool):
                            add(item)
                else:
                    walk(value, depth + 1)
        elif isinstance(node, list):
            for item in node:
                walk(item, depth + 1)

    walk(payload, 0)
    return found


def handle_webhook_event(connection, payload):
    """Uses the webhook body only to learn WHICH parcels changed, then reads
    their real status from PostEx's own API (bulk track) before applying
    anything - the body's format is undocumented, so it's never trusted for
    what status to apply. Returns how many orders visibly changed."""
    tracking_numbers = extract_tracking_numbers(payload)
    if not tracking_numbers:
        logger.warning("postex webhook for org %s: no tracking number found in the body",
                       connection.organization_id)
        return 0

    # FynkTech's own account (OMS Couriers) reports on Hub bookings that
    # belong to many stores - _shipments_for covers both cases.
    shipments = {
        s.tracking_number: s
        for s in _shipments_for(connection).filter(tracking_number__in=tracking_numbers)
    }
    if not shipments:
        logger.info("postex webhook for org %s: none of %s were booked from OMS",
                    connection.organization_id, tracking_numbers[:5])
        return 0

    try:
        rows = client.track_bulk(connection.api_token, list(shipments))
    except PostExAPIError:
        logger.exception("postex webhook: re-fetch failed for org %s", connection.organization_id)
        return 0

    updated = 0
    for tn, row in rows.items():
        shipment = shipments.get(tn)
        if not shipment:
            continue
        try:
            # The order's own store - the oms.services transitions rely on
            # the tenant context, which this JWT-less request never got.
            with tenant_context(shipment.organization_id):
                if _apply_fetched_status(shipment, row):
                    updated += 1
        except Exception:  # noqa: BLE001 - one shipment's failure must not drop the rest
            logger.exception("postex webhook: unexpected error handling shipment %s", tn)
    return updated


_RECENT_PAYLOADS_KEPT = 5
_PAYLOAD_MAX_CHARS = 20000


def record_webhook_received(connection, payload):
    """Counts an accepted call and keeps its body (newest first, last 5) so
    PostEx's undocumented payload shape can be inspected."""
    import json

    text = json.dumps(payload, default=str)
    kept = payload if len(text) <= _PAYLOAD_MAX_CHARS else {"_truncated": text[:_PAYLOAD_MAX_CHARS]}
    entry = {"received_at": timezone.now().isoformat(), "body": kept}
    connection.recent_webhook_payloads = [entry, *(connection.recent_webhook_payloads or [])][:_RECENT_PAYLOADS_KEPT]
    connection.events_received_count = F("events_received_count") + 1
    connection.last_event_at = timezone.now()
    connection.last_webhook_error = ""
    connection.save(update_fields=[
        "recent_webhook_payloads", "events_received_count", "last_event_at", "last_webhook_error", "updated_at",
    ])


def record_webhook_rejected(connection, reason):
    """Remembers why a call was turned away, for the integration page. At
    most one write a minute for the same reason, so a burst of bad calls
    can't turn into a burst of database writes."""
    now = timezone.now()
    if (
        connection.last_webhook_error == reason
        and connection.last_webhook_error_at
        and (now - connection.last_webhook_error_at).total_seconds() < 60
    ):
        return
    connection.last_webhook_error = reason[:255]
    connection.last_webhook_error_at = now
    connection.save(update_fields=["last_webhook_error", "last_webhook_error_at", "updated_at"])


# ------------------------------------------------------- Portal bookings --
# An order booked straight on PostEx's own portal (or by PostEx's Shopify
# app) never went through book_orders, so it has no PostExShipment row - and
# the poller, webhook and cancel only ever look at those rows. Every poll
# therefore first adopts such bookings, found two ways - the PostEx
# counterpart of Smartlane's absorb_untracked_smartlane_order:
# - by tracking number: an order that already carries one (typically from a
#   courier sheet imported into OMS, see oms/importers.py) is looked up
#   directly with bulk track, however old the booking is;
# - by reference: PostEx's own order list for a recent window, matching
#   orderRefNumber to our order numbers (bulk-uploaded portal bookings).

# Local statuses an order sits in before any courier booking - the same set
# as Smartlane's _ABSORBABLE_STATUSES (local copy, deliberately not
# imported). Adopting from here forces Booking Pending and consumes stock,
# exactly as booking through OMS would have.
_PRE_BOOKING_STATUSES = {
    "new", "pending_cc", "pending_cod",
    "awaiting_assigning", "awaiting_approval", "approved",
}
# Already past booking locally (processed by hand). Adopting one of these
# only links the shipment so its status keeps flowing - no forced move, no
# stock - and only when its courier is blank or PostEx. city_issue and
# dispatch_issue are in neither set: a human flagged those.
_TRACK_ONLY_STATUSES = {
    "booking_pending", "ready_to_print", "ready_to_pick", "awaiting_dispatched",
    "dispatched", "out_for_delivery", "attempt",
}

# get-all-order is slow over long ranges (see client.list_orders), so a
# range is read one week at a time.
_LIST_WINDOW_DAYS = 7


def list_orders_between(token, start, end, status_id=0):
    """client.list_orders over start..end (dates, inclusive), one
    _LIST_WINDOW_DAYS window per call."""
    rows = []
    cursor = start
    while cursor <= end:
        window_end = min(cursor + timedelta(days=_LIST_WINDOW_DAYS - 1), end)
        rows += client.list_orders(
            token, start_date=cursor.isoformat(), end_date=window_end.isoformat(), status_id=status_id,
        )
        cursor = window_end + timedelta(days=1)
    return rows


def _live_bookings_by_reference(rows):
    """{reference without '#': row} for every PostEx booking that isn't
    cancelled. A reference booked more than once (cancelled, then booked
    again) keeps its newest live row."""
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("orderRefNumber") or "").strip().lstrip("#")
        if not key or not str(row.get("trackingNumber") or "").strip():
            continue
        if status_stage(row.get("transactionStatus")) == "cancelled":
            continue
        current = result.get(key)
        if current is None or str(row.get("transactionDate") or "") > str(current.get("transactionDate") or ""):
            result[key] = row
    return result


def _courier(organization_id):
    from oms.models import Courier

    courier = Courier.all_objects.filter(organization_id=organization_id, name__iexact=COURIER_NAME).first()
    return courier or Courier.all_objects.create(organization_id=organization_id, name=COURIER_NAME, is_active=True)


def _adoptable_orders(organization_id):
    """Orders an outside-OMS booking may be adopted onto: not final, not
    flagged by a human, and not already PostEx's or BarqRaftar's."""
    from oms.models import Order

    return (
        Order.all_objects.filter(
            organization_id=organization_id,
            status__in=_PRE_BOOKING_STATUSES | _TRACK_ONLY_STATUSES,
        )
        .exclude(postex_shipments__is_active=True)
        .exclude(barqraftar_shipments__is_active=True)
        .select_related("courier")
    )


def _courier_key(order):
    """The order's courier name reduced to letters - courier sheets write it
    every way ("Post Ex", "POSTEX", "post-ex"), all of which become
    "postex"."""
    return re.sub(r"[^a-z]", "", (order.courier.name if order.courier_id else "").lower())


def _adopt_one(order, row, *, reference, tracking_number, known):
    """Saves the shipment, brings the order to where an OMS booking would
    have left it, then applies PostEx's current status from `row`. `known`
    is (tracking numbers, references) already used in this org - updated
    here. Returns True if the order was adopted."""
    from oms import services as oms_services

    known_tracking, known_references = known
    courier = _courier(order.organization_id)
    pre_booking = order.status in _PRE_BOOKING_STATUSES
    before_status = order.status
    try:
        with transaction.atomic():
            shipment = PostExShipment.all_objects.create(
                organization_id=order.organization_id,
                order=order,
                reference=reference,
                tracking_number=tracking_number,
                status_label=str(row.get("transactionStatus") or "")[:100],
                last_payload=row,
                is_active=True,
            )
            if pre_booking:
                oms_services.absorb_courier_booking(
                    order, courier_id=courier.id, tracking_number=tracking_number,
                    note="Booked on PostEx outside OMS - reconciled automatically",
                )
            else:
                order.courier = courier
                order.tracking_number = order.tracking_number or tracking_number
                order.save(update_fields=["courier", "tracking_number", "updated_at"])
    except Exception:  # noqa: BLE001 - one order's failure must not stop the rest
        logger.exception("postex: adopting booking %s for order %s failed", tracking_number, order.order_number)
        return False

    known_tracking.add(tracking_number)
    known_references.add(reference)
    logger.info("postex: adopted booking %s for order %s (was %s)",
                tracking_number, order.order_number, before_status)
    if not pre_booking:
        # No status change yet - the row itself changed, though.
        publish_event(
            "order.updated",
            {
                "organization_id": str(order.organization_id),
                "order_id": str(order.id),
                "order_number": order.order_number,
                "source": "postex",
            },
        )
    try:
        _apply_fetched_status(shipment, row)
    except Exception:  # noqa: BLE001 - the next poll retries it through the shipment row
        logger.exception("postex: applying status to adopted order %s failed", order.order_number)
    return True


# Most orders the tracking-number pass asks about per run. Ones PostEx
# doesn't know stay candidates, so this bounds what every cycle re-asks.
_ADOPT_TRACKING_LIMIT = 500


def _adopt_by_tracking_number(organization_id, connection, known):
    """Orders already carrying a PostEx tracking number (plain digits, see
    client.py) whose courier is blank or PostEx, looked up with bulk track.
    A chunk PostEx rejects is skipped, not fatal - the next poll asks again."""
    candidates = {}
    orders = _adoptable_orders(organization_id).exclude(tracking_number="").order_by("-updated_at")
    for order in orders[:_ADOPT_TRACKING_LIMIT]:
        tracking_number = order.tracking_number.strip()
        if tracking_number.isdigit() and tracking_number not in known[0] and _courier_key(order) in ("", "postex"):
            candidates.setdefault(tracking_number, order)

    numbers = list(candidates)
    adopted = 0
    for start in range(0, len(numbers), _TRACK_CHUNK_SIZE):
        try:
            rows = client.track_bulk(connection.api_token, numbers[start:start + _TRACK_CHUNK_SIZE])
        except PostExAPIError as exc:
            logger.error("postex: tracking-number adoption chunk failed for org %s: %s", organization_id, exc)
            continue
        for tracking_number, row in rows.items():
            order = candidates.get(tracking_number)
            if order is None:
                continue
            if status_stage(row.get("transactionStatus"), row.get("transactionStatusHistory")) == "cancelled":
                continue
            # PostEx's own reference when it has a free one, else the
            # tracking number - the reference is unique per org.
            reference = str(row.get("orderRefNumber") or "").strip()[:100]
            if not reference or reference in known[1]:
                reference = tracking_number[:100]
            if _adopt_one(order, row, reference=reference, tracking_number=tracking_number[:100], known=known):
                adopted += 1
    return adopted


def _adopt_by_reference(organization_id, connection, days, known):
    """PostEx bookings from the last `days` days whose orderRefNumber is one
    of our order numbers. Raises PostExAPIError if PostEx's order list
    couldn't be read."""
    # +1 day: the server's date can still be yesterday while it's already
    # today in Pakistan.
    end = timezone.localdate() + timedelta(days=1)
    bookings = _live_bookings_by_reference(
        list_orders_between(connection.api_token, end - timedelta(days=days), end)
    )
    if not bookings:
        return 0

    orders = _adoptable_orders(organization_id).filter(
        order_number__in=[n for key in bookings for n in (key, f"#{key}")],
    )
    adopted = 0
    for order in orders:
        row = bookings[order.order_number.lstrip("#")]
        reference = str(row["orderRefNumber"]).strip()[:100]
        tracking_number = str(row["trackingNumber"]).strip()[:100]
        if tracking_number in known[0] or reference in known[1]:
            # Already one of ours (an OMS booking since cancelled) - the
            # reference is unique per org, so it could not be saved again.
            continue
        if order.status not in _PRE_BOOKING_STATUSES and _courier_key(order) not in ("", "postex"):
            continue
        if _adopt_one(order, row, reference=reference, tracking_number=tracking_number, known=known):
            adopted += 1
    return adopted


def adopt_portal_bookings(organization_id, connection, *, days):
    """Adopts PostEx bookings made outside OMS - by tracking number first,
    then by reference over the last `days` days (see the section comment
    above). Returns how many orders were adopted. Raises PostExAPIError if
    PostEx's order list couldn't be read."""
    if days <= 0:
        return 0
    shipments = PostExShipment.all_objects.filter(organization_id=organization_id)
    known = (
        set(shipments.values_list("tracking_number", flat=True)),
        set(shipments.values_list("reference", flat=True)),
    )
    adopted = _adopt_by_tracking_number(organization_id, connection, known)
    return adopted + _adopt_by_reference(organization_id, connection, days, known)


def _adopt_for_poll(organization_id, connection, days):
    """adopt_portal_bookings for a poll run - never lets a failure there stop
    the status sync that follows. None means it failed."""
    if days is None:
        days = settings.POSTEX_ADOPT_LOOKBACK_DAYS
    try:
        return adopt_portal_bookings(organization_id, connection, days=days)
    except PostExAPIError as exc:
        logger.error("postex: portal-booking check failed for org %s: %s", organization_id, exc)
    except Exception:  # noqa: BLE001
        logger.exception("postex: portal-booking check failed for org %s", organization_id)
    return None


# ---------------------------------------------------------------- Poller --

_TRACK_CHUNK_SIZE = 50


def poll_postex_statuses(organization_id, *, limit=500, job=None, adopt_days=None):
    """Pulls status updates from PostEx for every active, non-final shipment
    of a connected org (oldest-checked first, at most `limit` per run) using
    bulk track. Scoped to PostExShipment rows, so it never guesses from an
    order's courier name.

    First adopts bookings made on PostEx's own portal over the last
    `adopt_days` days (default POSTEX_ADOPT_LOOKBACK_DAYS) - see
    adopt_portal_bookings. The result's "adopted" is None when that step
    failed; the status sync runs either way."""
    from core.context import current_organization_id

    connection = PostExConnection.all_objects.filter(organization_id=organization_id, is_connected=True).first()
    if not connection:
        logger.warning("postex poll skipped for org %s: not connected", organization_id)
        return {"checked": 0, "updated": 0, "detail": "PostEx is not connected"}

    context_token = current_organization_id.set(organization_id)
    try:
        # FynkTech's own account (OMS Couriers) has no orders of its own to
        # adopt portal bookings into - its shipments are the Hub's.
        adopted = (
            0 if is_platform_organization(organization_id)
            else _adopt_for_poll(organization_id, connection, adopt_days)
        )
        return {**_poll_body(organization_id, connection, limit=limit, job=job), "adopted": adopted}
    finally:
        current_organization_id.reset(context_token)


def _poll_body(organization_id, connection, *, limit, job=None):
    shipments = list(
        _shipments_for(connection)
        .exclude(tracking_number="")
        .exclude(order__status__in=TERMINAL_STATUSES)
        .order_by(F("last_checked_at").asc(nulls_first=True), "id")[:limit]
    )
    if job is not None:
        job.total_available = len(shipments)
        _save_progress(job, ["total_available", "updated_at"])
    if not shipments:
        _stamp_synced(connection)
        return {"checked": 0, "updated": 0}

    by_tracking = {s.tracking_number: s for s in shipments}
    tracking_numbers = list(by_tracking)
    checked = 0
    updated = 0

    for start in range(0, len(tracking_numbers), _TRACK_CHUNK_SIZE):
        chunk = tracking_numbers[start:start + _TRACK_CHUNK_SIZE]
        try:
            rows = client.track_bulk(connection.api_token, chunk)
        except PostExAPIError as exc:
            logger.error("postex poll chunk failed for org %s (%s shipment(s)): %s",
                         organization_id, len(chunk), exc)
            continue

        checked += len(chunk)
        for tn, row in rows.items():
            shipment = by_tracking.get(tn)
            if not shipment:
                continue
            try:
                # The shipment's own store - FynkTech's account polls many.
                with tenant_context(shipment.organization_id):
                    if _apply_fetched_status(shipment, row):
                        updated += 1
            except Exception:  # noqa: BLE001 - one shipment's failure must not abort the batch
                logger.exception("postex poll: unexpected error handling shipment %s", tn)

        # Numbers PostEx didn't return are still stamped as checked, so they
        # rotate to the back instead of being asked about every cycle.
        unseen = [t for t in chunk if t not in rows]
        if unseen:
            PostExShipment.all_objects.filter(
                id__in=[by_tracking[t].id for t in unseen],
            ).update(last_checked_at=timezone.now())

        if job is not None:
            job.checked_count = checked
            job.updated_count = updated
            _save_progress(job, ["checked_count", "updated_count", "updated_at"])
            job.refresh_from_db(fields=["cancel_requested", "status"])
            if job.cancel_requested:
                return {"checked": checked, "updated": updated, "cancelled": True}

    _stamp_synced(connection)
    logger.info("postex poll for org %s finished: checked %s, updated %s", organization_id, checked, updated)
    return {"checked": checked, "updated": updated}


def _stamp_synced(connection):
    connection.last_synced_at = timezone.now()
    connection.save(update_fields=["last_synced_at", "updated_at"])


def run_postex_sync(organization_id, job_id):
    """Thread target behind the integration page's "Sync now" - same shape
    as BarqRaftar's run_barqraftar_sync."""
    from django.db import connections

    job = PostExSyncJob.all_objects.get(organization_id=organization_id, id=job_id)
    try:
        job.status = "running"
        job.started_at = timezone.now()
        _save_progress(job, ["status", "started_at", "updated_at"])

        result = poll_postex_statuses(organization_id, job=job)

        job.checked_count = result.get("checked", job.checked_count)
        job.updated_count = result.get("updated", job.updated_count)
        job.status = "cancelled" if result.get("cancelled") else "completed"
        job.finished_at = timezone.now()
        _save_progress(job, ["checked_count", "updated_count", "status", "finished_at", "updated_at"])
    except Exception as exc:  # noqa: BLE001 - unsupervised background thread, must not vanish silently
        logger.exception("postex sync job %s failed for org %s", job_id, organization_id)
        job.status = "failed"
        job.error_message = str(exc)[:500]
        job.finished_at = timezone.now()
        try:
            _save_progress(job, ["status", "error_message", "finished_at", "updated_at"])
        except OperationalError:
            pass
    finally:
        connections.close_all()


def _save_progress(job, update_fields, attempts=3, delay_seconds=3):
    """Short retry so a transient Supabase pooler blip doesn't fail a run."""
    for attempt in range(attempts):
        try:
            job.save(update_fields=update_fields)
            return
        except OperationalError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay_seconds)
