"""Domain logic for the BarqRaftar integration - booking, city matching,
status mapping, the background poller's body, the manual "Sync now" runner,
webhook handling and cancel-with-courier.

Deliberately has NO import of anything from integrations/services.py,
integrations/smartlane_client.py or integrations/poller.py (Smartlane), and
nothing in those files imports this package either - the two integrations
share no code, so nothing here can ever change Smartlane's behaviour and
vice versa. Where the same *shape* of logic is needed (catching an order up
to Dispatched before applying a later status, for instance), it's a small
local copy, not a shared import - see _catch_up_to_dispatched below.

Every function here takes/returns plain oms.Order instances and calls
public oms.services functions (book_with_courier, advance_booking_confirmed,
mark_returned_by_courier, cancel_order, flag_city_issue, ...) - none of it
reaches into oms.services' own private helpers directly except via those.
"""

import logging
import re
import time
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.db.utils import OperationalError
from django.utils import timezone

from core.events import publish_event

from .client import BarqRaftarAPIError
from . import client
from .exceptions import BarqRaftarBookingError
from .models import BarqRaftarConnection, BarqRaftarShipment, BarqRaftarSyncJob

logger = logging.getLogger(__name__)

# Local copy - same three statuses as integrations/services.py's
# TERMINAL_STATUSES, deliberately not imported from there (see the module
# docstring).
TERMINAL_STATUSES = {"delivered", "returned", "cancelled"}

# BarqRaftar's own numeric status ids (from their Postman collection's
# description - "Status IDs" section). Only ever moves an order forward -
# see apply_barqraftar_status.
_DISPATCH_CODES = {3, 30, 31, 32}  # picked_up, rfc_origin, in_transit, received_at_fc
_OUT_FOR_DELIVERY_CODES = {4}  # dispatched (rider assigned/out)
_ATTEMPT_CODES = {5, 6, 7, 14}  # return_by_consignee, re_attempt_requested, hold_requested, re_attempt_approval
_RETURN_IN_PROGRESS_CODES = {8, 10, 11, 12, 13}  # return_requested..return_rfc_origin
_DELIVERED_CODES = {9}
_RETURNED_CODES = {98}  # returned_to_shipper
_CANCELLED_CODES = {99}
# 1 (pending), 2 (awaiting_pickup) - no local status change; still
# cancellable, used by cancel_on_barqraftar below.
_STILL_CANCELLABLE_CODES = {1, 2}


# --------------------------------------------------------------- Helpers --

def _coerce_status_code(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_order_fields(row):
    """Defensively reads one BarqRaftar order row (GET /order,
    get_multiple_orders, or a bulk_store orders_result entry). BarqRaftar's
    exact response shape isn't confirmed against a real response (the
    Postman collection's saved responses are all empty), so several
    plausible field spellings are tried for each value rather than
    assuming one. Returns (tracking_number, reference_id, status_code,
    status_label, status_logs)."""
    if not isinstance(row, dict):
        return "", "", None, "", []
    data = row.get("data") if isinstance(row.get("data"), dict) else row
    tracking_number = (
        data.get("tracking_number") or data.get("number") or data.get("order_number") or ""
    )
    reference_id = (
        data.get("reference_id") or data.get("customer_reference") or data.get("reference") or ""
    )
    status_code = _coerce_status_code(data.get("status") if "status" in data else data.get("status_id"))
    status_label = str(
        data.get("status_label") or data.get("new_status") or data.get("status") or ""
    )
    logs = data.get("status_logs")
    if not isinstance(logs, list):
        logs = []
    return str(tracking_number), str(reference_id), status_code, status_label, logs


def extract_webhook_event(payload):
    """Reads BarqRaftar's order_status_change webhook payload - the only
    sample shape available is the one in their Postman collection's
    "Simulate order_status_change" request:
    {"payload": {"payload_data": {"new_status": ..., "order": {"number":
    ..., "status": ..., "customer_reference": ...}}}}. Returns
    (tracking_number, reference_id, status_code, status_label). The webhook
    itself only uses this to find WHICH shipment to re-check (see
    handle_webhook_event below) - the status applied always comes from a
    fresh GET /order call, never straight from this payload, since the
    webhook carries no signature to trust it outright."""
    if not isinstance(payload, dict):
        return "", "", None, ""
    envelope = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
    payload_data = (
        envelope.get("payload_data") if isinstance(envelope.get("payload_data"), dict) else envelope
    )
    order = payload_data.get("order") if isinstance(payload_data.get("order"), dict) else {}
    tracking_number = order.get("number") or order.get("tracking_number") or ""
    reference_id = order.get("customer_reference") or order.get("reference_id") or ""
    status_code = _coerce_status_code(order.get("status"))
    status_label = str(payload_data.get("new_status") or order.get("status") or "")
    return str(tracking_number), str(reference_id), status_code, status_label


def _normalize_phone(phone):
    """Pakistani mobile number -> "92XXXXXXXXXX" (12 digits), or None if it
    can't be made into one. BarqRaftar's own example
    ("923001234567") is exactly this shape."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("0092"):
        digits = digits[2:]
    if digits.startswith("92") and len(digits) == 12:
        return digits
    if digits.startswith("0") and len(digits) == 11:
        return "92" + digits[1:]
    if len(digits) == 10:
        return "92" + digits
    return None


# ----------------------------------------------------------- City match --

# Very short forms staff actually type/import that a plain city-name match
# would miss. Checked before a per-connection alias (see
# BarqRaftarConnection.city_aliases, editable from the Cities tab) is even
# needed. Deliberately small and literal - no fuzzy/partial matching, since
# a wrong auto-match would silently address a parcel to the wrong city.
_BUILT_IN_CITY_ALIASES = {
    "khi": "karachi",
    "lhr": "lahore",
    "isb": "islamabad",
    "isl": "islamabad",
    "rwp": "rawalpindi",
    "pindi": "rawalpindi",
    "fsd": "faisalabad",
    "mux": "multan",
    "hyd": "hyderabad",
    "pew": "peshawar",
    "qta": "quetta",
}


def _normalize_city_name(name):
    cleaned = re.sub(r"[^a-z0-9]+", " ", (name or "").strip().lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def get_cities(connection, *, force_refresh=False):
    """Returns BarqRaftar's city list, refreshing from their API if the
    cache is empty, missing a timestamp, or older than 24h. Raises
    BarqRaftarAPIError if a refresh was needed and the API call itself
    failed - callers must not treat that as "no cities" (see
    resolve_city_id's docstring and book_orders, which calls this once
    upfront specifically so that failure is reported clearly instead of
    silently sending every order to City Issue)."""
    stale = (
        force_refresh
        or not connection.cities_cache
        or not connection.cities_cached_at
        or (timezone.now() - connection.cities_cached_at) > timedelta(hours=24)
    )
    if not stale:
        return connection.cities_cache

    rows = client.fetch_cities(connection.api_key, connection.api_secret)
    cities = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        city_id = row.get("id") if "id" in row else row.get("city_id")
        name = row.get("name") or row.get("city") or row.get("city_name")
        if city_id is None or not name:
            continue
        cities.append({"id": city_id, "name": str(name)})

    connection.cities_cache = cities
    connection.cities_cached_at = timezone.now()
    connection.save(update_fields=["cities_cache", "cities_cached_at", "updated_at"])
    return cities


def resolve_city_id(connection, city_name):
    """Normalised exact match of `city_name` against BarqRaftar's cached
    city list, trying the connection's own alias table first, then the
    small built-in one above. Returns {"id":..., "name":...} or None (no
    match - the caller sends the order to City Issue instead of guessing).
    Uses whatever is already cached on `connection` - call get_cities()
    once upfront if a fresh list matters; this never triggers its own
    network call, so a per-order loop never re-hits the cities API."""
    cities = connection.cities_cache or []
    if not cities:
        return None

    normalized = _normalize_city_name(city_name)
    if not normalized:
        return None

    alias_target = (connection.city_aliases or {}).get(normalized) or _BUILT_IN_CITY_ALIASES.get(normalized)
    lookup = _normalize_city_name(alias_target) if alias_target else normalized

    for city in cities:
        if _normalize_city_name(city["name"]) == lookup:
            return city
    return None


# ------------------------------------------------------------- Payload --

def _order_weight(order, connection):
    total = 0
    for item in order.items.all():
        grams = item.weight_grams or 0
        if grams:
            total += grams * item.quantity
    return total or connection.default_weight_grams


def _cod_amount(order):
    """COD is only collected for orders genuinely paid cash-on-delivery -
    see the module's book_orders docstring for why `amount_receivable`
    alone isn't a safe signal (Shopify orders never populate amount_paid,
    so a prepaid order's amount_receivable can equal its full grand_total).
    Same rule Smartlane's own client applies via payment_method - see
    integrations/smartlane_client.py's _build_consignment."""
    if order.payment_gateway == "cod":
        return float(order.amount_receivable)
    return 0


def _next_reference_id(order):
    """order.order_number (without '#'), or -R2/-R3/... if an earlier
    attempt already used the plain form and was cancelled (see
    cancel_on_barqraftar/release_shipment_stock_and_deactivate - the old
    shipment row stays as history, never deleted or reused). Rebooking with
    the same reference id a second time is exactly what produces
    BarqRaftar's "Order already exist" error."""
    base = order.order_number.lstrip("#") or order.order_number
    existing = set(
        BarqRaftarShipment.all_objects.filter(
            organization_id=order.organization_id, order=order
        ).values_list("reference_id", flat=True)
    )
    if base not in existing:
        return base
    n = 2
    while f"{base}-R{n}" in existing:
        n += 1
    return f"{base}-R{n}"


def _build_order_payload(order, connection, city, reference_id):
    phone = _normalize_phone(order.customer_phone)
    if not phone:
        raise BarqRaftarBookingError(
            f"Order {order.order_number}: customer phone {order.customer_phone!r} "
            "isn't a valid Pakistani number - fix it before booking."
        )
    address = " ".join(p for p in [order.address_line1, order.address_line2] if p).strip()
    if not address:
        raise BarqRaftarBookingError(f"Order {order.order_number} has no shipping address.")

    cod_amount = _cod_amount(order)
    line_items = [
        {"name": item.product_name, "quantity": item.quantity} for item in order.items.all()
    ]
    return {
        "reference_id": reference_id,
        "customer_name": order.customer_name or "Customer",
        "customer_address": address,
        "customer_contact": phone,
        "customer_email": order.customer_email or "",
        "special_handling": False,
        "total_amount": float(order.grand_total),
        "cod_amount": cod_amount,
        "to_city_id": city["id"],
        "from_city_id": connection.from_city_id,
        "shipment_type": "cod" if cod_amount > 0 else "courier",
        "weight_grams": _order_weight(order, connection),
        "line_items": line_items or [{"name": order.order_number, "quantity": 1}],
    }


def _match_bulk_store_results(chunk_refs, rows):
    """Maps bulk_store's orders_result rows back to the reference ids that
    were sent, by reference_id first; only falls back to matching by
    position when NONE matched by reference_id and the counts line up
    exactly (never a partial positional guess - see the module docstring's
    defensive-parsing note)."""
    by_ref = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        ref = row.get("reference_id") or row.get("reference") or row.get("customer_reference")
        if ref:
            by_ref[str(ref)] = row
    matched = {ref: by_ref[ref] for ref in chunk_refs if ref in by_ref}
    if not matched and len(rows) == len(chunk_refs):
        matched = {ref: row for ref, row in zip(chunk_refs, rows) if isinstance(row, dict)}
    return matched


# --------------------------------------------------------------- Booking --

_BOOKING_CHUNK_SIZE = 25


def book_orders(organization_id, order_ids, *, actor_user_id=None, force=False):
    """Books one or many orders with BarqRaftar in one pass - the handler
    behind the "Book with BarqRaftar" action (see oms/views.py's
    bulk_action, which calls this directly for action="push_to_barqraftar"
    instead of going through BULK_ACTIONS/the per-order loop there).

    Batches the actual BarqRaftar API call (25 orders per bulk_store
    request) specifically so selecting many orders with "create a pickup
    request" on creates ONE pickup request per batch, not one per order.

    Returns a list of {"order_id", "order_number", "success", "error"?,
    "error_code"?, "shortages"?} dicts - exactly the shape oms/views.py's
    generic bulk-action loop already returns, so the frontend's stock-
    shortage modal and force-retry work unchanged.
    """
    from oms.models import Courier, Order
    from oms import services as oms_services
    from wms import services as wms_services

    orders_by_id = {
        str(o.id): o
        for o in Order.objects.filter(organization_id=organization_id, id__in=order_ids).prefetch_related("items")
    }

    try:
        connection = BarqRaftarConnection.objects.get(organization_id=organization_id, is_connected=True)
    except BarqRaftarConnection.DoesNotExist:
        return [
            {"order_id": str(oid), "success": False,
             "error": "Connect BarqRaftar from the Integrations page first."}
            for oid in order_ids
        ]

    if connection.create_pickup_request and not connection.pickup_address_id:
        return [
            {"order_id": str(oid), "success": False,
             "error": "Set a default pickup address on the BarqRaftar integration page first."}
            for oid in order_ids
        ]

    try:
        get_cities(connection)
    except BarqRaftarAPIError as exc:
        return [
            {"order_id": str(oid), "success": False, "error": f"Could not load BarqRaftar cities: {exc}"}
            for oid in order_ids
        ]

    results = []
    to_book = []

    for order_id in order_ids:
        order = orders_by_id.get(str(order_id))
        if not order:
            results.append({"order_id": str(order_id), "success": False, "error": "Not found"})
            continue

        if order.status != "awaiting_assigning":
            results.append({
                "order_id": str(order_id), "order_number": order.order_number, "success": False,
                "error": f"Order {order.order_number} is {order.get_status_display()}, not Awaiting Assigning.",
            })
            continue

        city = resolve_city_id(connection, order.city)
        if city is None:
            note = f"BarqRaftar: no city match for {order.city!r}"
            oms_services.flag_city_issue(order, note, actor_user_id=actor_user_id)
            results.append({
                "order_id": str(order_id), "order_number": order.order_number, "success": False,
                "error": f"No BarqRaftar city match for {order.city!r} - moved to City Issue.",
            })
            continue

        shortages = wms_services.check_order_stock(order)
        if shortages and not force:
            results.append({
                "order_id": str(order_id), "order_number": order.order_number, "success": False,
                "error": str(wms_services.InsufficientStock(shortages)),
                "error_code": "insufficient_stock", "shortages": shortages,
            })
            continue

        try:
            reference_id = _next_reference_id(order)
            payload = _build_order_payload(order, connection, city, reference_id)
        except BarqRaftarBookingError as exc:
            results.append({
                "order_id": str(order_id), "order_number": order.order_number,
                "success": False, "error": str(exc),
            })
            continue

        to_book.append({
            "order_id": str(order_id), "order": order, "reference_id": reference_id, "payload": payload,
        })

    if not to_book:
        return results

    courier = Courier.objects.filter(organization_id=organization_id, name__iexact="BarqRaftar").first()
    if courier is None:
        courier = Courier.objects.create(organization_id=organization_id, name="BarqRaftar", is_active=True)

    for start in range(0, len(to_book), _BOOKING_CHUNK_SIZE):
        chunk = to_book[start:start + _BOOKING_CHUNK_SIZE]
        chunk_refs = [b["reference_id"] for b in chunk]
        payloads = [b["payload"] for b in chunk]

        try:
            response = client.bulk_store(
                connection.api_key, connection.api_secret, payloads,
                create_pickup_request=connection.create_pickup_request,
                pickup_address_id=connection.pickup_address_id or None,
            )
        except BarqRaftarAPIError as exc:
            for b in chunk:
                results.append({
                    "order_id": b["order_id"], "order_number": b["order"].order_number,
                    "success": False, "error": f"BarqRaftar booking failed: {exc}",
                })
            continue

        rows = response.get("orders_result") if isinstance(response, dict) else None
        rows = rows if isinstance(rows, list) else []
        matched = _match_bulk_store_results(chunk_refs, rows)

        for b in chunk:
            ref = b["reference_id"]
            row = matched.get(ref)
            tracking_number = ""
            error_message = ""

            if row is not None:
                tn, _r, _s, _sl, _logs = _extract_order_fields(row)
                if row.get("success") and tn:
                    tracking_number = tn
                elif row.get("success"):
                    error_message = "BarqRaftar accepted the order but returned no tracking number."
                else:
                    error_message = str(
                        row.get("message") or row.get("error") or "BarqRaftar rejected this order."
                    )

            if not tracking_number and not error_message:
                # Not matched in the response at all, or BarqRaftar's
                # "Order already exist" - confirm directly rather than
                # guessing what happened.
                try:
                    confirm_row = client.get_order(
                        connection.api_key, connection.api_secret, reference_id=ref,
                    )
                    tn, _r, _s, _sl, _logs = _extract_order_fields(confirm_row)
                    if tn:
                        tracking_number = tn
                    else:
                        error_message = (
                            "BarqRaftar didn't confirm this booking - try Sync now shortly, "
                            "or Book with BarqRaftar again."
                        )
                except BarqRaftarAPIError:
                    error_message = (
                        "BarqRaftar didn't confirm this booking - try Sync now shortly, "
                        "or Book with BarqRaftar again."
                    )

            if not tracking_number:
                results.append({
                    "order_id": b["order_id"], "order_number": b["order"].order_number,
                    "success": False, "error": error_message,
                })
                continue

            try:
                _finalize_booking(
                    b["order"], reference_id=ref, tracking_number=tracking_number,
                    courier=courier, connection=connection, actor_user_id=actor_user_id,
                )
                results.append({
                    "order_id": b["order_id"], "order_number": b["order"].order_number, "success": True,
                })
            except Exception as exc:  # noqa: BLE001 - one order's failure must not lose the rest
                logger.exception("barqraftar: finalize booking failed for %s", b["order"].order_number)
                results.append({
                    "order_id": b["order_id"], "order_number": b["order"].order_number,
                    "success": False,
                    "error": (
                        f"Booked with BarqRaftar (tracking {tracking_number}) but failed to update "
                        f"the order locally: {exc}. Use Sync now to reconcile."
                    ),
                })

    return results


def _finalize_booking(order, *, reference_id, tracking_number, courier, connection, actor_user_id):
    """Saves the shipment row FIRST, before any local status change - so a
    failure in the local transition below never loses the one thing that
    can't be recovered without calling BarqRaftar again (the tracking
    number). Then moves the order straight through Booking Pending to
    Ready to Print in one atomic block, since (unlike Smartlane) BarqRaftar
    hands back a real tracking number immediately."""
    from oms import services as oms_services

    BarqRaftarShipment.all_objects.create(
        organization_id=order.organization_id,
        order=order,
        reference_id=reference_id,
        tracking_number=tracking_number,
        is_active=True,
        pickup_requested=connection.create_pickup_request,
    )
    with transaction.atomic():
        order = oms_services.book_with_courier(
            order, courier_id=courier.id, tracking_number=tracking_number, actor_user_id=actor_user_id,
        )
        oms_services.advance_booking_confirmed(order, actor_user_id=actor_user_id)
    return order


# --------------------------------------------------------------- Cancel --

def cancel_on_barqraftar(order):
    """Calls BarqRaftar's status API to cancel the live consignment for
    `order`. Raises BarqRaftarBookingError if BarqRaftar reports it can no
    longer be cancelled (already picked up) or if the check/cancel call
    itself fails - oms.services.cancel_order lets that propagate and does
    NOT proceed with a local cancel in that case, since a live consignment
    the courier is already carrying is more authoritative than the local
    screen. No-ops (returns None) if there is no active BarqRaftar shipment
    for this order at all."""
    shipment = BarqRaftarShipment.all_objects.filter(
        organization_id=order.organization_id, order=order, is_active=True
    ).first()
    if not shipment or not shipment.tracking_number:
        return

    connection = BarqRaftarConnection.all_objects.filter(
        organization_id=order.organization_id, is_connected=True
    ).first()
    if not connection:
        raise BarqRaftarBookingError(
            "BarqRaftar is not connected - cannot confirm whether the shipment can still be cancelled."
        )

    try:
        row = client.get_order(
            connection.api_key, connection.api_secret, tracking_number=shipment.tracking_number,
        )
    except BarqRaftarAPIError as exc:
        raise BarqRaftarBookingError(
            f"Could not check BarqRaftar's status before cancelling: {exc}"
        ) from exc

    _tn, _ref, status_code, status_label, _logs = _extract_order_fields(row)

    if status_code in _CANCELLED_CODES or status_code is None:
        return  # Already cancelled on BarqRaftar, or nothing usable to check against.
    if status_code in _STILL_CANCELLABLE_CODES:
        try:
            client.change_status(
                connection.api_key, connection.api_secret,
                [{"tracking_number": shipment.tracking_number, "status": "cancelled"}],
            )
        except BarqRaftarAPIError as exc:
            raise BarqRaftarBookingError(f"BarqRaftar refused to cancel: {exc}") from exc
        return
    raise BarqRaftarBookingError(
        f"BarqRaftar reports this shipment is already {status_label or status_code} "
        "- it can no longer be cancelled."
    )


def release_shipment_stock_and_deactivate(order, *, actor_user_id=None):
    """Puts back the stock consume_for_order took for this order's
    BarqRaftar booking, and deactivates its shipment row (a rebook then
    creates a fresh row - see _next_reference_id). Called by
    oms.services.cancel_order's BarqRaftar branch, after cancel_on_barqraftar
    (or instead of it, when propagate_to_courier=False). Uses
    organization_id explicitly (all_objects) rather than the tenant-scoped
    manager, since this can run from a webhook or poller thread that never
    went through TenantMiddleware."""
    from wms import services as wms_services

    wms_services.release_order_stock(
        order, actor_user_id=actor_user_id, note="Order cancelled (BarqRaftar)"
    )
    BarqRaftarShipment.all_objects.filter(
        organization_id=order.organization_id, order=order, is_active=True
    ).update(is_active=False, cancelled_at=timezone.now())


# ------------------------------------------------------- Local catch-up --
# Small, deliberate copies of integrations/services.py's
# _catch_up_to_dispatched / _advance_to_dispatch_substate (Smartlane) - same
# shape, because both integrations report the same kind of courier sub-
# stages, but re-implemented here rather than imported so this package has
# zero runtime dependency on Smartlane's code. Only calls PUBLIC
# oms.services functions.

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


def apply_barqraftar_status(order, shipment, status_code, *, tracking_number="", actor_user_id=None):
    """Applies one BarqRaftar status id to one order - shared by the
    webhook and the poller (via _apply_fetched_status below) so a status
    seen either way can never produce a different outcome, same reasoning
    as Smartlane's own apply_smartlane_status. Only ever moves an order
    forward. Raises oms.services.InvalidTransition for the caller to
    log/skip (a stale/out-of-order status, not a real problem)."""
    from oms import services as oms_services

    if status_code in _RETURN_IN_PROGRESS_CODES:
        # Informational only, same role as Order.return_in_progress_at for
        # Smartlane - never itself a status transition.
        if not order.return_in_progress_at:
            order.return_in_progress_at = timezone.now()
            order.save(update_fields=["return_in_progress_at", "updated_at"])
        return False

    if status_code in _DELIVERED_CODES:
        if order.status == "delivered":
            return False
        _catch_up_to_dispatched(order, tracking_number)
        oms_services.mark_delivered(order)
        return True

    if status_code in _RETURNED_CODES:
        if order.status == "returned":
            return False
        _catch_up_to_dispatched(order, tracking_number)
        oms_services.mark_returned_by_courier(order, reason="Reported returned by BarqRaftar")
        return True

    if status_code in _CANCELLED_CODES:
        if order.status == "cancelled":
            return False
        # propagate_to_courier=False: BarqRaftar has already told us it's
        # cancelled - calling their API again here would be pointless.
        oms_services.cancel_order(
            order, reason="Cancelled by BarqRaftar", actor_user_id=actor_user_id,
            propagate_to_courier=False,
        )
        return True

    if status_code in _OUT_FOR_DELIVERY_CODES or status_code in _ATTEMPT_CODES:
        target = "out_for_delivery" if status_code in _OUT_FOR_DELIVERY_CODES else "attempt"
        return _advance_to_dispatch_substate(order, target, tracking_number)

    if status_code in _DISPATCH_CODES:
        if order.status == "dispatched":
            return False
        return _catch_up_to_dispatched(order, tracking_number)

    return False


def _apply_fetched_status(shipment, row):
    """Shared body for the poller and the webhook: records `row` on the
    shipment, restores a tracking number Shopify's own sync may have
    blanked (see integrations/services.py's upsert_order_from_shopify -
    only when it's actually missing locally, so this never fights a more
    recent value), self-heals a stuck Booking Pending, then applies the
    status. Returns True if the order visibly moved (status changed, or a
    missing tracking number was filled in)."""
    from oms.models import Order
    from oms import services as oms_services

    tn, _ref, status_code, status_label, logs = _extract_order_fields(row)
    order = Order.all_objects.filter(id=shipment.order_id).first()
    if not order:
        return False

    before_status = order.status
    filled_tracking = False

    shipment.last_checked_at = timezone.now()
    shipment.last_payload = row if isinstance(row, dict) else {}
    if status_code is not None:
        shipment.status_code = status_code
    if status_label:
        shipment.status_label = status_label
    if logs:
        shipment.status_logs = logs

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
                "source": "barqraftar",
            },
        )

    shipment.save(
        update_fields=["last_checked_at", "last_payload", "status_code", "status_label", "status_logs"]
    )

    if status_code is None:
        return filled_tracking

    # Self-heal: an order can only ever reach here from Booking Pending if
    # _finalize_booking's advance_booking_confirmed step somehow didn't run
    # (a crash mid-atomic-block, or a shipment adopted with no local
    # transition applied yet). Without this, "Not booked - retry" is the
    # only way out of Booking Pending and would release stock for a
    # shipment that, per this very row, is real.
    if order.status == "booking_pending" and shipment.tracking_number:
        try:
            oms_services.advance_booking_confirmed(order)
        except oms_services.InvalidTransition:
            pass

    try:
        apply_barqraftar_status(
            order, shipment, status_code, tracking_number=shipment.tracking_number,
        )
    except oms_services.InvalidTransition:
        logger.info(
            "barqraftar: order %s at %s, ignoring status %s (stale/out of order)",
            order.order_number, order.status, status_code,
        )

    order.refresh_from_db(fields=["status"])
    return filled_tracking or (order.status != before_status)


# --------------------------------------------------------------- Webhook --

def handle_webhook_event(connection, payload):
    """Treats the webhook payload only as a trigger ("something changed for
    this tracking number/reference") and re-fetches the real status with
    GET /order before applying anything - BarqRaftar's webhook carries no
    signature (confirmed: their Postman collection describes registering
    the URL with support, nothing about signing), so the payload itself is
    never trusted for what status to apply, only for which shipment to
    check."""
    from core.context import current_organization_id

    tracking_number, reference_id, _status_code, _status_label = extract_webhook_event(payload)
    if not tracking_number and not reference_id:
        logger.warning("barqraftar webhook: payload had neither a tracking number nor a reference id")
        return

    context_token = current_organization_id.set(connection.organization_id)
    try:
        qs = BarqRaftarShipment.all_objects.filter(
            organization_id=connection.organization_id, is_active=True,
        )
        qs = qs.filter(tracking_number=tracking_number) if tracking_number else qs.filter(reference_id=reference_id)
        shipment = qs.first()
        if not shipment:
            logger.info(
                "barqraftar webhook: no active shipment for tracking=%r reference=%r",
                tracking_number, reference_id,
            )
            return

        try:
            if shipment.tracking_number:
                row = client.get_order(
                    connection.api_key, connection.api_secret, tracking_number=shipment.tracking_number,
                )
            else:
                row = client.get_order(
                    connection.api_key, connection.api_secret, reference_id=shipment.reference_id,
                )
        except BarqRaftarAPIError:
            logger.exception("barqraftar webhook: re-fetch failed for %s", shipment.tracking_number)
            return

        _apply_fetched_status(shipment, row)
    finally:
        current_organization_id.reset(context_token)


# ---------------------------------------------------------------- Poller --

def poll_barqraftar_statuses(organization_id, *, batch_size=50, limit=500, job=None):
    """Pulls status updates from BarqRaftar for every active shipment of a
    connected org - the scheduled-job counterpart to the webhook, same
    reasoning as integrations.services.poll_smartlane_statuses (works from
    anywhere, doesn't need a publicly reachable webhook URL).

    Scoped to BarqRaftarShipment rows, NOT "every non-final order" the way
    Smartlane's poller is - Smartlane has to cast that wide because it has
    no shipment table of its own and needs to notice orders booked outside
    this app entirely; BarqRaftar orders are always booked through
    book_orders above, so there is always a shipment row to key off, and
    this never has to guess from an order's courier name.
    """
    from core.context import current_organization_id

    try:
        connection = BarqRaftarConnection.all_objects.get(organization_id=organization_id, is_connected=True)
    except BarqRaftarConnection.DoesNotExist:
        logger.warning("barqraftar poll skipped for org %s: not connected", organization_id)
        return {"checked": 0, "updated": 0, "detail": "BarqRaftar is not connected"}

    context_token = current_organization_id.set(organization_id)
    try:
        return _poll_barqraftar_statuses_body(organization_id, connection, batch_size=batch_size, limit=limit, job=job)
    finally:
        current_organization_id.reset(context_token)


def _poll_barqraftar_statuses_body(organization_id, connection, *, batch_size, limit, job=None):
    shipments = list(
        BarqRaftarShipment.all_objects.filter(organization_id=organization_id, is_active=True)
        .exclude(order__status__in=TERMINAL_STATUSES)
        .select_related("order")
        .order_by(F("last_checked_at").asc(nulls_first=True), "id")[:limit]
    )
    if not shipments:
        logger.info("barqraftar poll for org %s: no active shipments to check", organization_id)
        if job is not None:
            job.total_available = 0
            _save_progress(job, ["total_available", "updated_at"])
        return {"checked": 0, "updated": 0}

    logger.info("barqraftar poll for org %s: checking %s shipment(s)", organization_id, len(shipments))
    if job is not None:
        job.total_available = len(shipments)
        _save_progress(job, ["total_available", "updated_at"])

    by_tracking = {s.tracking_number: s for s in shipments if s.tracking_number}
    tracking_numbers = list(by_tracking.keys())
    checked = 0
    updated = 0

    for start in range(0, len(tracking_numbers), batch_size):
        chunk = tracking_numbers[start:start + batch_size]
        try:
            rows = client.get_multiple_orders(connection.api_key, connection.api_secret, chunk)
        except BarqRaftarAPIError as exc:
            logger.error(
                "barqraftar poll chunk failed for org %s (%s shipment(s)): %s",
                organization_id, len(chunk), exc,
            )
            continue

        checked += len(chunk)
        seen = set()
        for row in rows:
            tn, _ref, _s, _sl, _logs = _extract_order_fields(row)
            shipment = by_tracking.get(tn)
            if not shipment:
                continue
            seen.add(tn)
            try:
                if _apply_fetched_status(shipment, row):
                    updated += 1
            except Exception:  # noqa: BLE001 - one shipment's failure must not abort the batch
                logger.exception("barqraftar poll: unexpected error handling shipment %s", tn)

        # Anything asked about but absent from the response is still
        # stamped as checked, same reasoning as Smartlane's poller - so a
        # shipment BarqRaftar doesn't currently recognise isn't asked about
        # again on every single cycle.
        unseen = [t for t in chunk if t not in seen]
        if unseen:
            BarqRaftarShipment.all_objects.filter(
                organization_id=organization_id, tracking_number__in=unseen,
            ).update(last_checked_at=timezone.now())

        if job is not None:
            job.checked_count = checked
            job.updated_count = updated
            _save_progress(job, ["checked_count", "updated_count", "updated_at"])
            job.refresh_from_db(fields=["cancel_requested", "status"])
            if job.cancel_requested:
                logger.info(
                    "barqraftar poll for org %s: cancelled after %s/%s shipment(s)",
                    organization_id, checked, len(shipments),
                )
                return {"checked": checked, "updated": updated, "cancelled": True}

    connection.last_event_at = timezone.now()
    connection.save(update_fields=["last_event_at"])
    logger.info(
        "barqraftar poll for org %s finished: checked %s, updated %s", organization_id, checked, updated
    )
    return {"checked": checked, "updated": updated}


def run_barqraftar_sync(organization_id, job_id):
    """Thread target behind the BarqRaftar page's "Sync now" button - exact
    mirror of integrations.services.run_smartlane_sync's shape, so the
    manual-sync UX matches across both integration pages."""
    from django.db import connections

    job = BarqRaftarSyncJob.all_objects.get(organization_id=organization_id, id=job_id)
    try:
        job.status = "running"
        job.started_at = timezone.now()
        _save_progress(job, ["status", "started_at", "updated_at"])

        result = poll_barqraftar_statuses(organization_id, job=job)

        job.checked_count = result.get("checked", job.checked_count)
        job.updated_count = result.get("updated", job.updated_count)
        job.status = "cancelled" if result.get("cancelled") else "completed"
        job.finished_at = timezone.now()
        _save_progress(job, ["checked_count", "updated_count", "status", "finished_at", "updated_at"])
    except Exception as exc:  # noqa: BLE001 - unsupervised background thread, must not vanish silently
        logger.exception("barqraftar sync job %s failed for org %s", job_id, organization_id)
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
    """Same short-retry shape as integrations.services._save_progress - a
    transient Supabase pooler DNS blip must not fail a whole sync run."""
    for attempt in range(attempts):
        try:
            job.save(update_fields=update_fields)
            return
        except OperationalError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay_seconds)
