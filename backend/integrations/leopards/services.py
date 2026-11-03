"""Domain logic for the Leopards Courier integration - booking, city
matching, status mapping, the Push API webhook handler, the poller's body,
the manual "Sync now" runner and cancel-with-courier.

Same structure as integrations/postex/services.py but shares no code with it
(or with BarqRaftar's or Smartlane's): nothing here imports any of them, and
none imports this. Where the same *shape* of logic is needed (catching an
order up to Dispatched before applying a later status), it's a small local
copy. Everything goes through PUBLIC oms.services functions
(book_with_courier, advance_booking_confirmed, mark_returned_by_courier,
cancel_order, ...).

Statuses arrive two ways: Leopards' Push API (the webhook, see
handle_webhook_event - its body is documented, so the pushed status is used
directly), and, as the backup for any push Leopards misses, the background
poller (leopards/poller.py, gated by LEOPARDS_AUTO_POLL) plus the
integration page's "Sync now" - both run poll_leopards_statuses.

Every order in OMS that carries the courier name "Leopards" is NOT
necessarily booked through here - every org has a manual courier of that
name, and sheet imports / Shopify fulfillments attach orders to it. So all
of this works from LeopardsShipment rows, never from the name.
"""

import logging
import re
import time
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.db.utils import OperationalError
from django.utils import timezone

from core.context import audit_source, tenant_context
from core.events import publish_event
from core.platform_service import (
    is_platform_organization,
    platform_organization_id,
    platform_reference,
)

from . import client
from .exceptions import LeopardsAPIError, LeopardsBookingError
from .models import LeopardsConnection, LeopardsShipment, LeopardsSyncJob

logger = logging.getLogger(__name__)

# Local copy of the OMS statuses a courier can no longer move - same three as
# PostEx's/BarqRaftar's/Smartlane's own copies, deliberately not imported.
TERMINAL_STATUSES = {"delivered", "returned", "cancelled"}

COURIER_NAME = "Leopards"


# -------------------------------------------------------- Status mapping --
# Leopards' Push API sends the status as one of 16 short codes (its
# "Shipment Journey" table); the tracking API's booked_packet_status is the
# status NAME. Both map to the same stage here. Only ever moves an OMS order
# forward - see apply_leopards_status.
#
#   code  name
#   RC    Consignment Booked (Shipment Scanned In LCS Facility)
#   AC    Assigned To Courier (Out For Delivery)
#   DV    Delivered                                   - terminal
#   PN1   First Attempt In Forward Leg
#   PN2   Second Attempt In Forward Leg
#   RO    Being Return
#   RN1   First Attempt In Reverse Leg
#   RN2   Second Attempt In Reverse Leg
#   RW    Returned to Warehouse                       - terminal
#   DW    Delivered to Warehouse                      - terminal
#   RS    Returned to Shipper                         - terminal
#   DR    Delivered to Vendor                         - terminal
#   AR    Arrived At Station
#   DP    Dispatched
#   NR    Ready for Return
#   SP    Shipment Picked

_STAGE_BY_CODE = {
    "RC": "dispatched",
    "SP": "dispatched",
    "AR": "dispatched",
    "DP": "dispatched",
    "AC": "out_for_delivery",
    "PN1": "attempt",
    "PN2": "attempt",
    "RO": "return_in_progress",
    "RN1": "return_in_progress",
    "RN2": "return_in_progress",
    "NR": "return_in_progress",
    "DV": "delivered",
    "RW": "returned",
    "DW": "returned",
    "RS": "returned",
    "DR": "returned",
}

# The words OMS shows as the order's Sub Status for each code - Leopards' own
# names, shortened.
_NAME_BY_CODE = {
    "RC": "Consignment Booked",
    "SP": "Shipment Picked",
    "AR": "Arrived At Station",
    "DP": "Dispatched",
    "AC": "Out For Delivery",
    "PN1": "First Attempt",
    "PN2": "Second Attempt",
    "RO": "Being Return",
    "RN1": "First Attempt In Reverse Leg",
    "RN2": "Second Attempt In Reverse Leg",
    "NR": "Ready for Return",
    "DV": "Delivered",
    "RW": "Returned to Warehouse",
    "DW": "Delivered to Warehouse",
    "RS": "Returned to Shipper",
    "DR": "Delivered to Vendor",
}

_STAGE_BY_TEXT = {
    # Before Leopards has the parcel. "Pickup Request not Send" is what its
    # own sample answers show for a freshly booked packet.
    "pickup request not send": "pending",
    "pickup request not sent": "pending",
    "pickup request send": "pending",
    "pickup request sent": "pending",
    "booked": "pending",
    # The push table's names (tracking answers use the same vocabulary).
    "consignment booked": "dispatched",
    "shipment scanned in lcs facility": "dispatched",
    "shipment picked": "dispatched",
    "arrived at station": "dispatched",
    "dispatched": "dispatched",
    "assigned to courier": "out_for_delivery",
    "out for delivery": "out_for_delivery",
    "first attempt in forward leg": "attempt",
    "second attempt in forward leg": "attempt",
    "being return": "return_in_progress",
    "ready for return": "return_in_progress",
    "first attempt in reverse leg": "return_in_progress",
    "second attempt in reverse leg": "return_in_progress",
    "delivered": "delivered",
    "returned to warehouse": "returned",
    "delivered to warehouse": "returned",
    "returned to shipper": "returned",
    "delivered to vendor": "returned",
    "cancelled": "cancelled",
    "canceled": "cancelled",
}

# Leopards stages from which our own cancel still asks Leopards to cancel
# (anything later means the parcel is already with Leopards).
_CANCELLABLE_STAGES = {"pending"}


def _normalize_status(label):
    text = re.sub(r"\(.*?\)", " ", str(label or ""))
    return re.sub(r"\s+", " ", text.strip().lower())


def status_stage(label):
    """A Leopards status - the push API's short code ("DV") or a status name
    ("Delivered") - to one of pending / dispatched / out_for_delivery /
    attempt / return_in_progress / returned / delivered / cancelled, or None
    if it can't be told."""
    code = str(label or "").strip().upper()
    if code in _STAGE_BY_CODE:
        return _STAGE_BY_CODE[code]
    normalized = _normalize_status(label)
    stage = _STAGE_BY_TEXT.get(normalized)
    if stage:
        return stage
    # Wordings a plain table can't list: "Second Attempt - Customer not
    # available", "Return to Shipper in transit", ...
    if "attempt" in normalized:
        return "return_in_progress" if "reverse" in normalized or "return" in normalized else "attempt"
    if "return" in normalized:
        return "return_in_progress"
    return None


def status_name(label):
    """What the order's Sub Status should say: the code's full name, else
    Leopards' own text unchanged."""
    code = str(label or "").strip().upper()
    return _NAME_BY_CODE.get(code) or str(label or "").strip()


def row_status(row):
    """The status of one trackBookedPacket row: its booked_packet_status, or
    - if that's empty - the newest "Tracking Detail" entry (Leopards'
    sample spells the key "Staus", so both spellings are read)."""
    label = str((row or {}).get("booked_packet_status") or "").strip()
    if label:
        return label
    for entry in reversed((row or {}).get("Tracking Detail") or []):
        if isinstance(entry, dict):
            found = str(entry.get("Status") or entry.get("Staus") or "").strip()
            if found:
                return found
    return ""


# --------------------------------------------------------------- Helpers --

def _normalize_phone(phone):
    """Pakistani mobile number -> "03XXXXXXXXX" (the format Leopards'
    examples use), or None if it can't be made into one."""
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
# Targets are Leopards' own city names. Deliberately small and literal - no
# fuzzy matching, since a wrong auto-match would send a parcel to the wrong
# city.
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
    "dg khan": "dera ghazi khan",
    "d g khan": "dera ghazi khan",
    "di khan": "dera ismail khan",
    "d i khan": "dera ismail khan",
    "ryk": "rahim yar khan",
}


def _normalize_city_name(name):
    cleaned = re.sub(r"[^a-z0-9]+", " ", (name or "").strip().lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def get_cities(connection, *, force_refresh=False):
    """Leopards' cities as [{"id", "name", "origin", "destination"}],
    refreshed from its API if the cache is empty or older than 24h. Raises
    LeopardsAPIError if a refresh was needed and failed - callers must not
    read that as "no cities" (book_orders calls this once upfront for exactly
    that reason)."""
    stale = (
        force_refresh
        or not connection.cities_cache
        or not connection.cities_cached_at
        or (timezone.now() - connection.cities_cached_at) > timedelta(hours=24)
    )
    if not stale:
        return connection.cities_cache

    return cache_cities(connection, client.get_all_cities(connection))


def cache_cities(connection, rows):
    """Turns getAllCities rows into the [{"id", "name", "origin",
    "destination"}] list saved on the connection, and saves it. Also used by
    the connect view, which has just fetched the rows to check the
    credentials."""
    seen = set()
    cities = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        try:
            city_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        if not name or city_id in seen:
            continue
        seen.add(city_id)
        cities.append({
            "id": city_id,
            "name": name,
            # Flags default to "yes" when Leopards leaves them out.
            "origin": row.get("allow_as_origin") not in (False, 0, "0", "false"),
            "destination": row.get("allow_as_destination") not in (False, 0, "0", "false"),
        })
    cities.sort(key=lambda c: c["name"].lower())

    connection.cities_cache = cities
    connection.cities_cached_at = timezone.now()
    connection.save(update_fields=["cities_cache", "cities_cached_at", "updated_at"])
    return cities


def resolve_city(connection, city_name):
    """Normalised exact match of `city_name` against the cached Leopards
    destination cities, trying the connection's own aliases first, then the
    built-in ones. Returns {"id", "name"} or None. Never makes a network
    call itself."""
    cities = [c for c in (connection.cities_cache or []) if c.get("destination", True)]
    normalized = _normalize_city_name(city_name)
    if not cities or not normalized:
        return None
    alias_target = (connection.city_aliases or {}).get(normalized) or _BUILT_IN_CITY_ALIASES.get(normalized)
    lookup = _normalize_city_name(alias_target) if alias_target else normalized
    for city in cities:
        if _normalize_city_name(city["name"]) == lookup:
            return {"id": city["id"], "name": city["name"]}
    return None


# ------------------------------------------------------------- Payload --

def _cod_amount(order):
    """COD is only collected for orders genuinely paid cash-on-delivery -
    same rule as PostEx's _cod_amount (amount_receivable alone isn't a safe
    signal: Shopify orders never populate amount_paid)."""
    if order.payment_gateway == "cod":
        return int(round(order.amount_receivable))
    return 0


def _piece_count(order):
    return sum(item.quantity for item in order.items.all()) or 1


def _order_weight(order, connection):
    """Grams - the items' own weights, or the connection's default when none
    of them has one."""
    total = 0
    for item in order.items.all():
        grams = item.weight_grams or 0
        total += grams * (item.quantity or 1)
    return total or connection.default_weight_grams


# ------------------------------------------------------ Booking accounts --
# Same arrangement as PostEx's (see its services.py): a store's orders book
# through its own Leopards account - or, from the Dispatch Hub, through
# FynkTech's own (the super admin's OMS Couriers tab, held by the platform
# org - core.platform_service). Order.platform_reference marks such a
# booking, so tracking, printing, cancelling, the poller and the webhook all
# use FynkTech's account for it.

def platform_connection():
    """FynkTech's own connected Leopards account, or None."""
    return LeopardsConnection.all_objects.filter(
        organization_id=platform_organization_id(), is_connected=True
    ).first()


def connection_for_order(order):
    """The connected account `order` was booked through."""
    if order.platform_reference:
        return platform_connection()
    return LeopardsConnection.all_objects.filter(
        organization_id=order.organization_id, is_connected=True
    ).first()


def connection_for_request(request):
    """The account a request acts on: FynkTech's own while operating the
    Dispatch Hub (every Hub booking goes through it), else the store's."""
    if getattr(request, "organization_ids", None):
        return platform_connection()
    return LeopardsConnection.objects.filter(
        organization_id=request.organization_id, is_connected=True
    ).first()


def store_shipper(organization_id):
    """The store's own shipper on FynkTech's Leopards account - created from
    its OMS Courier request when the super admin approved it
    (integrations.oms_courier_service). Every booking of its orders through
    FynkTech's account goes out under it. Returns {"shipment_id", "details"}
    or None if there is none."""
    from integrations.models import OmsCourierEnrollment

    enrollment = OmsCourierEnrollment.all_objects.filter(
        organization_id=organization_id,
        courier=OmsCourierEnrollment.COURIER_LEOPARDS,
        status=OmsCourierEnrollment.STATUS_APPROVED,
        is_enabled=True,
    ).first()
    if enrollment is None or not enrollment.courier_reference:
        return None
    return {"shipment_id": enrollment.courier_reference, "details": enrollment.details or {}}


def _shipments_for(connection):
    """Active shipments booked through `connection`: the store's own - or,
    for FynkTech's account, every Hub booking made through it, whichever
    store's order it is."""
    qs = LeopardsShipment.all_objects.filter(is_active=True)
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
        LeopardsShipment.all_objects.filter(organization_id=order.organization_id, order=order)
        .values_list("reference", flat=True)
    )
    if base not in existing:
        return base
    n = 2
    while f"{base}-R{n}" in existing:
        n += 1
    return f"{base}-R{n}"


def _build_packet(order, connection, city, reference, shipper):
    """The bookPacket body. `shipper` is None for a booking through the
    store's own Leopards account (Leopards fills the shipper in from the
    account: "self"), or store_shipper()'s dict for FynkTech's account."""
    phone = _normalize_phone(order.customer_phone) or _normalize_phone(order.secondary_phone)
    if not phone:
        raise LeopardsBookingError(
            f"Order {order.order_number}: customer phone {order.customer_phone!r} "
            "isn't a valid Pakistani mobile number - fix it before booking."
        )
    address = " ".join(p for p in [order.address_line1, order.address_line2] if p).strip()
    if not address:
        raise LeopardsBookingError(f"Order {order.order_number} has no shipping address.")
    second = _normalize_phone(order.secondary_phone)

    if shipper is None:
        origin = connection.origin_city_id or "self"
        shipper_fields = {
            "shipment_id": "",
            "shipment_name_eng": "self",
            "shipment_email": "self",
            "shipment_phone": "self",
            "shipment_address": "self",
        }
    else:
        details = shipper["details"]
        try:
            origin = int(details.get("city_id"))
        except (TypeError, ValueError):
            raise LeopardsBookingError(
                f"Order {order.order_number}: this store's Leopards request has no pickup city - "
                "reject it so the store sends the form again."
            ) from None
        shipper_fields = {
            "shipment_id": shipper["shipment_id"],
            "shipment_name_eng": details.get("name") or "",
            "shipment_email": details.get("email") or "",
            "shipment_phone": details.get("phone") or "",
            "shipment_address": details.get("address") or "",
        }

    packet = {
        "booked_packet_weight": _order_weight(order, connection),
        "booked_packet_vol_weight_w": "",
        "booked_packet_vol_weight_h": "",
        "booked_packet_vol_weight_l": "",
        "booked_packet_no_piece": _piece_count(order),
        "booked_packet_collect_amount": _cod_amount(order),
        "booked_packet_order_id": reference,
        "origin_city": origin,
        "destination_city": city["id"],
        **shipper_fields,
        "consignment_name_eng": (order.customer_name or "Customer")[:100],
        "consignment_email": order.customer_email or "",
        "consignment_phone": phone,
        "consignment_phone_two": second if second and second != phone else "",
        "consignment_phone_three": "",
        "consignment_address": address[:500],
        "special_instructions": connection.default_notes or "N/A",
        "shipment_type": connection.default_shipment_type or "",
        "custom_data": [],
        "return_address": "",
        "return_city": "",
        "is_vpc": 0,
    }
    return packet


# --------------------------------------------------------------- Booking --

def book_orders(organization_id, order_ids, *, actor_user_id=None, force=False, via_platform=False):
    """Books one or many orders with Leopards - the handler behind "Book with
    Leopards" (oms/views.py's bulk_action special-cases
    action="push_to_leopards" and calls this directly). One bookPacket call
    per order; Leopards answers with a CN and slip link immediately, so a
    booked order goes straight to Ready to Print.

    Returns [{"order_id", "order_number", "success", "error"?, "error_code"?,
    "shortages"?}] - the same shape as oms/views.py's generic bulk-action
    loop, so the stock-shortage modal and its force-retry work unchanged.

    via_platform books through FynkTech's own account instead of the store's
    - the Dispatch Hub's bookings (see "Booking accounts" above)."""
    from oms.models import Courier, Order
    from wms import services as wms_services

    orders_by_id = {
        str(o.id): o
        for o in Order.objects.filter(organization_id=organization_id, id__in=order_ids).prefetch_related("items")
    }

    if via_platform:
        connection = platform_connection()
        not_connected = "Connect FynkTech's Leopards account on the super admin's OMS Couriers tab first."
    else:
        connection = LeopardsConnection.objects.filter(organization_id=organization_id, is_connected=True).first()
        not_connected = "Connect Leopards from the Integrations page first."
    if not connection:
        return [{"order_id": str(oid), "success": False, "error": not_connected} for oid in order_ids]

    # Through FynkTech's account, the store's own shipper on it.
    shipper = None
    if via_platform:
        shipper = store_shipper(organization_id)
        if shipper is None:
            return [
                {
                    "order_id": str(oid), "success": False,
                    "error": "This store's Leopards shipper isn't on FynkTech's account yet - approve its "
                             "Leopards request under OMS Couriers > Requests.",
                }
                for oid in order_ids
            ]

    try:
        get_cities(connection)
    except LeopardsAPIError as exc:
        return [
            {"order_id": str(oid), "success": False, "error": f"Could not load Leopards cities: {exc}"}
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
                "error": f"Order {order.order_number} is {order.get_status_display()}, not Assigning Courier.",
            })
            continue

        city = resolve_city(connection, order.city)
        if city is None:
            # Left in Awaiting Assigning (same choice as PostEx) - add an
            # alias on the Cities tab, or book it with another courier.
            results.append({
                **base, "success": False,
                "error": (
                    f"Leopards doesn't recognise the city {order.city!r} - order left in Awaiting "
                    "Assigning. Add a city alias on the Leopards Cities tab, or book it with another courier."
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
            packet = _build_packet(order, connection, city, reference, shipper)
        except LeopardsBookingError as exc:
            results.append({**base, "success": False, "error": str(exc)})
            continue

        try:
            answer = client.book_packet(connection, packet)
        except LeopardsAPIError as exc:
            results.append({**base, "success": False, "error": f"Leopards booking failed: {exc}"})
            continue

        tracking_number = str(answer.get("track_number") or "").strip()
        if not tracking_number:
            results.append({
                **base, "success": False,
                "error": "Leopards accepted the packet but returned no CN number - check the Leopards portal "
                         "before booking it again.",
            })
            continue

        if courier is None:
            courier = Courier.objects.filter(organization_id=organization_id, name__iexact=COURIER_NAME).first()
            if courier is None:
                courier = Courier.objects.create(organization_id=organization_id, name=COURIER_NAME, is_active=True)

        try:
            _finalize_booking(
                order, reference=reference, tracking_number=tracking_number,
                slip_link=str(answer.get("slip_link") or ""), courier=courier,
                actor_user_id=actor_user_id, via_platform=via_platform,
                shipper_id=shipper["shipment_id"] if shipper else "",
            )
            results.append({**base, "success": True})
        except Exception as exc:  # noqa: BLE001 - one order's failure must not lose the rest
            logger.exception("leopards: finalize booking failed for %s", order.order_number)
            results.append({
                **base, "success": False,
                "error": (
                    f"Booked with Leopards (CN {tracking_number}) but failed to update the order "
                    f"locally: {exc}. Use Sync now to reconcile."
                ),
            })

    return results


def _finalize_booking(order, *, reference, tracking_number, slip_link, courier, actor_user_id,
                      via_platform=False, shipper_id=""):
    """Saves the shipment row FIRST, so a failure in the local transition
    below never loses the CN. Then moves the order through Booking Pending
    to Ready to Print in one atomic block."""
    from oms import services as oms_services

    LeopardsShipment.all_objects.create(
        organization_id=order.organization_id,
        order=order,
        reference=reference,
        tracking_number=tracking_number,
        slip_link=slip_link[:500],
        shipper_id=str(shipper_id or ""),
        status_label="Booked",
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


def mark_load_sheet_generated(shipments, load_sheet_id):
    LeopardsShipment.all_objects.filter(id__in=[s.id for s in shipments]).update(
        load_sheet_at=timezone.now(), load_sheet_id=str(load_sheet_id)[:50],
    )


# --------------------------------------------------------------- Cancel --

def cancel_on_leopards(order):
    """Asks Leopards to cancel the live consignment for `order`. Raises
    LeopardsBookingError if Leopards already has the parcel (or refuses /
    can't be reached) - oms.services.cancel_order lets that propagate and
    does NOT cancel locally, since a parcel the courier is carrying outranks
    the local screen. No-op if the order has no active Leopards shipment."""
    shipment = LeopardsShipment.all_objects.filter(
        organization_id=order.organization_id, order=order, is_active=True
    ).first()
    if not shipment or not shipment.tracking_number:
        return

    connection = connection_for_order(order)
    if not connection:
        raise LeopardsBookingError(
            "Leopards is not connected - cannot confirm whether the shipment can still be cancelled."
        )

    try:
        rows = client.track_packets(connection, [shipment.tracking_number])
    except LeopardsAPIError as exc:
        raise LeopardsBookingError(f"Could not check Leopards' status before cancelling: {exc}") from exc

    row = rows.get(shipment.tracking_number)
    label = row_status(row)
    stage = status_stage(label)
    if not row or stage == "cancelled":
        return  # Leopards doesn't have it (any more), or it's already cancelled there.
    if stage not in _CANCELLABLE_STAGES:
        raise LeopardsBookingError(
            f"Leopards reports this shipment as {label or 'in progress'} - it can no longer be cancelled."
        )
    try:
        client.cancel_packets(connection, [shipment.tracking_number])
    except LeopardsAPIError as exc:
        raise LeopardsBookingError(f"Leopards refused to cancel: {exc}") from exc


def release_shipment_stock_and_deactivate(order, *, actor_user_id=None):
    """Puts back the stock booking consumed and deactivates the shipment row
    (a rebook then creates a fresh row - see _next_reference). Called by
    oms.services.cancel_order's Leopards branch. Uses organization_id
    explicitly since this can run from the poller thread, outside any
    request's tenant context."""
    from wms import services as wms_services

    shipments = LeopardsShipment.all_objects.filter(organization_id=order.organization_id, order=order)
    # An order can carry a courier named "Leopards" without ever having been
    # booked through this integration (CSV import, Shopify fulfillment
    # sync, manual edit, Smartlane routing) - leave its stock alone, only
    # bookings made here consumed any.
    if not shipments.exists():
        return
    wms_services.release_order_stock(order, actor_user_id=actor_user_id, note="Order cancelled (Leopards)")
    shipments.filter(is_active=True).update(is_active=False, cancelled_at=timezone.now())


# ------------------------------------------------------- Local catch-up --
# Small, deliberate copies of PostEx's helpers of the same name - same
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


@audit_source("Leopards")
def apply_leopards_status(order, stage, *, tracking_number="", actor_user_id=None):
    """Applies one Leopards stage to one order. Only ever moves an order
    forward. Raises oms.services.InvalidTransition for the caller to
    log/skip (a stale/out-of-order status, not a real problem)."""
    from oms import services as oms_services

    if stage == "return_in_progress":
        # Informational, same role as for the other couriers.
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
        oms_services.mark_returned_by_courier(order, reason="Reported returned by Leopards")
        return True

    if stage == "cancelled":
        if order.status == "cancelled":
            return False
        # Leopards already says it's cancelled - don't call their API again.
        oms_services.cancel_order(
            order, reason="Cancelled on Leopards", actor_user_id=actor_user_id, propagate_to_courier=False,
        )
        return True

    if stage in ("out_for_delivery", "attempt"):
        return _advance_to_dispatch_substate(order, stage, tracking_number)

    if stage == "dispatched":
        if order.status == "dispatched":
            return False
        return _catch_up_to_dispatched(order, tracking_number)

    return False


def _apply_status(shipment, *, label, stage, history_entry=None, payload=None):
    """Records one Leopards status on the shipment, restores a tracking
    number Shopify's own sync may have blanked on the order, self-heals a
    stuck Booking Pending, then applies the stage. Shared by the webhook
    (a pushed event) and the poller (a tracked row). Returns True if the
    order visibly changed."""
    from oms.models import Order
    from oms import services as oms_services

    order = Order.all_objects.filter(id=shipment.order_id).first()
    if not order:
        return False

    before_status = order.status
    filled_tracking = False

    shipment.last_checked_at = timezone.now()
    if payload is not None:
        shipment.last_payload = payload
    if label:
        shipment.status_label = str(label)[:100]
    history = list(shipment.status_history or [])
    if history_entry and (not history or history[-1] != history_entry):
        history.append(history_entry)
        shipment.status_history = history[-50:]
    shipment.save(update_fields=["last_checked_at", "last_payload", "status_label", "status_history", "updated_at"])
    # Leopards' own word ("Arrived At Station", ...) for the orders list's
    # Sub Status - most of them all land on Dispatched.
    oms_services.record_courier_status(order, status_name(label))

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
                "source": "leopards",
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
        apply_leopards_status(order, stage, tracking_number=shipment.tracking_number)
    except oms_services.InvalidTransition:
        logger.info("leopards: order %s at %s, ignoring %r (stale/out of order)",
                    order.order_number, order.status, label)

    order.refresh_from_db(fields=["status"])
    return filled_tracking or (order.status != before_status)


def _apply_fetched_status(shipment, row):
    """One trackBookedPacket row applied to its shipment."""
    if not isinstance(row, dict):
        return False
    label = row_status(row)
    entry = {
        "status": label,
        "reason": str(row.get("status_remarks") or ""),
        "activity_date": str(row.get("activity_date") or ""),
    }
    return _apply_status(shipment, label=label, stage=status_stage(label), history_entry=entry, payload=row)


# --------------------------------------------------------------- Webhook --

_WEBHOOK_MAX_EVENTS = 500


def webhook_events(payload):
    """The events in a Push API body - {"data": [{cn_number, status,
    receiver_name, reason, activity_date}, ...]}. A bare list, or a single
    event object, are accepted too, in case Leopards' sender differs from
    its document. Oldest first, so a burst for one parcel is applied in
    order."""
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        raw = payload["data"]
    elif isinstance(payload, list):
        raw = payload
    elif isinstance(payload, dict) and payload.get("cn_number"):
        raw = [payload]
    else:
        raw = []
    events = [e for e in raw if isinstance(e, dict) and str(e.get("cn_number") or "").strip()]
    events = events[:_WEBHOOK_MAX_EVENTS]
    events.sort(key=lambda e: str(e.get("activity_date") or ""))
    return events


def handle_webhook_event(connection, payload):
    """Applies Leopards' pushed statuses. The Push API body is documented
    (unlike PostEx's), so a pushed status code is used directly; an event
    whose status isn't one we know is resolved by reading the parcel back
    from Leopards' tracking API instead. Returns how many orders visibly
    changed."""
    events = webhook_events(payload)
    if not events:
        logger.warning("leopards webhook for org %s: no events (cn_number) in the body",
                       connection.organization_id)
        return 0

    cns = list({str(e["cn_number"]).strip() for e in events})
    # FynkTech's own account (OMS Couriers) reports on Hub bookings that
    # belong to many stores - _shipments_for covers both cases.
    shipments = {
        s.tracking_number: s
        for s in _shipments_for(connection).filter(tracking_number__in=cns)
    }
    if not shipments:
        logger.info("leopards webhook for org %s: none of %s were booked from OMS",
                    connection.organization_id, cns[:5])
        return 0

    updated = 0
    unknown = set()
    for event in events:
        cn = str(event["cn_number"]).strip()
        shipment = shipments.get(cn)
        if not shipment:
            continue
        label = str(event.get("status") or "").strip()
        stage = status_stage(label)
        if stage is None:
            unknown.add(cn)
            continue
        entry = {
            "status": label,
            "reason": str(event.get("reason") or ""),
            "receiver_name": str(event.get("receiver_name") or ""),
            "activity_date": str(event.get("activity_date") or ""),
        }
        try:
            # The order's own store - the oms.services transitions rely on
            # the tenant context, which this JWT-less request never got.
            with tenant_context(shipment.organization_id):
                shipment = LeopardsShipment.all_objects.get(id=shipment.id)
                shipments[cn] = shipment
                if _apply_status(shipment, label=label, stage=stage, history_entry=entry, payload=event):
                    updated += 1
        except Exception:  # noqa: BLE001 - one event's failure must not drop the rest
            logger.exception("leopards webhook: unexpected error handling shipment %s", cn)

    if unknown:
        try:
            rows = _track_chunk(connection, sorted(unknown))
        except LeopardsAPIError:
            logger.exception("leopards webhook: re-fetch failed for org %s", connection.organization_id)
            rows = {}
        for cn, row in rows.items():
            shipment = shipments.get(cn)
            if not shipment:
                continue
            try:
                with tenant_context(shipment.organization_id):
                    if _apply_fetched_status(LeopardsShipment.all_objects.get(id=shipment.id), row):
                        updated += 1
            except Exception:  # noqa: BLE001
                logger.exception("leopards webhook: unexpected error handling shipment %s", cn)
    return updated


_RECENT_PAYLOADS_KEPT = 5
_PAYLOAD_MAX_CHARS = 20000


def record_webhook_received(connection, payload):
    """Counts an accepted call and keeps its body (newest first, last 5) so
    the real payload shape can be inspected."""
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


# --------------------------------------------------------------- Polling --

_TRACK_CHUNK_SIZE = 50


def _track_chunk(connection, cns):
    """track_packets for `cns`, isolating a bad CN: Leopards refuses the
    whole bulk call when one number in it is unknown, so on an "api" error
    the list is split in half and each half retried, down to single numbers
    (whose failure just means "no answer for this one"). Credential and
    network failures aren't retried - splitting can't fix them."""
    try:
        return client.track_packets(connection, cns)
    except LeopardsAPIError as exc:
        if exc.kind != "api":
            raise
        if len(cns) == 1:
            logger.info("leopards: no tracking answer for %s: %s", cns[0], exc)
            return {}
        middle = len(cns) // 2
        merged = _track_chunk(connection, cns[:middle])
        merged.update(_track_chunk(connection, cns[middle:]))
        return merged


def poll_leopards_statuses(organization_id, *, limit=500, job=None):
    """Pulls status updates from Leopards for every active, non-final
    shipment of a connected org (oldest-checked first, at most `limit` per
    run) using bulk track. Scoped to LeopardsShipment rows, so it never
    guesses from an order's courier name.

    Unlike PostEx's poller it does not adopt bookings made on Leopards' own
    portal (a later addition via getShipmentDetailsByOrderID)."""
    from core.context import current_organization_id

    connection = LeopardsConnection.all_objects.filter(organization_id=organization_id, is_connected=True).first()
    if not connection:
        logger.warning("leopards poll skipped for org %s: not connected", organization_id)
        return {"checked": 0, "updated": 0, "detail": "Leopards is not connected"}

    context_token = current_organization_id.set(organization_id)
    try:
        return _poll_body(organization_id, connection, limit=limit, job=job)
    finally:
        current_organization_id.reset(context_token)


def _poll_body(organization_id, connection, *, limit, job=None, store_id=None):
    """`store_id` narrows FynkTech's account to one store's Hub bookings -
    see poll_store_platform_statuses."""
    scope = _shipments_for(connection)
    if store_id is not None:
        scope = scope.filter(organization_id=store_id)
    shipments = list(
        scope
        .exclude(tracking_number="")
        .exclude(order__status__in=TERMINAL_STATUSES)
        .order_by(F("last_checked_at").asc(nulls_first=True), "id")[:limit]
    )
    if job is not None:
        job.total_available = len(shipments)
        _save_progress(job, ["total_available", "updated_at"])
    if not shipments:
        if store_id is None:
            _stamp_synced(connection)
        return {"checked": 0, "updated": 0}

    by_tracking = {s.tracking_number: s for s in shipments}
    tracking_numbers = list(by_tracking)
    checked = 0
    updated = 0

    for start in range(0, len(tracking_numbers), _TRACK_CHUNK_SIZE):
        chunk = tracking_numbers[start:start + _TRACK_CHUNK_SIZE]
        try:
            rows = _track_chunk(connection, chunk)
        except LeopardsAPIError as exc:
            logger.error("leopards poll chunk failed for org %s (%s shipment(s)): %s",
                         organization_id, len(chunk), exc)
            continue

        checked += len(chunk)
        for cn, row in rows.items():
            shipment = by_tracking.get(cn)
            if not shipment:
                continue
            try:
                # The shipment's own store - FynkTech's account polls many.
                with tenant_context(shipment.organization_id):
                    if _apply_fetched_status(shipment, row):
                        updated += 1
            except Exception:  # noqa: BLE001 - one shipment's failure must not abort the batch
                logger.exception("leopards poll: unexpected error handling shipment %s", cn)

        # Numbers Leopards didn't answer for are still stamped as checked, so
        # they rotate to the back instead of being asked about every cycle.
        unseen = [t for t in chunk if t not in rows]
        if unseen:
            LeopardsShipment.all_objects.filter(
                id__in=[by_tracking[t].id for t in unseen],
            ).update(last_checked_at=timezone.now())

        if job is not None:
            job.checked_count = checked
            job.updated_count = updated
            _save_progress(job, ["checked_count", "updated_count", "updated_at"])
            job.refresh_from_db(fields=["cancel_requested", "status"])
            if job.cancel_requested:
                return {"checked": checked, "updated": updated, "cancelled": True}

    # One store's slice says nothing about the account as a whole.
    if store_id is None:
        _stamp_synced(connection)
    logger.info("leopards poll for org %s finished: checked %s, updated %s", organization_id, checked, updated)
    return {"checked": checked, "updated": updated}


# A store's "Sync now" runs inside the request, so it asks about at most
# this many of the store's shipments - oldest-checked first, so pressing it
# again moves on to the rest.
_STORE_SYNC_LIMIT = 200


def poll_store_platform_statuses(store_id, *, limit=_STORE_SYNC_LIMIT):
    """The OMS Courier page's "Sync now": FynkTech's Leopards account asked
    about one store's Hub bookings only, instead of waiting for the
    background poller. None when FynkTech's account isn't connected."""
    from core.context import current_organization_id

    connection = platform_connection()
    if connection is None:
        return None
    context_token = current_organization_id.set(connection.organization_id)
    try:
        return _poll_body(connection.organization_id, connection, limit=limit, store_id=store_id)
    finally:
        current_organization_id.reset(context_token)


def _stamp_synced(connection):
    connection.last_synced_at = timezone.now()
    connection.save(update_fields=["last_synced_at", "updated_at"])


def run_leopards_sync(organization_id, job_id):
    """Thread target behind the integration page's "Sync now" - same shape
    as PostEx's run_postex_sync."""
    from django.db import connections

    job = LeopardsSyncJob.all_objects.get(organization_id=organization_id, id=job_id)
    try:
        job.status = "running"
        job.started_at = timezone.now()
        _save_progress(job, ["status", "started_at", "updated_at"])

        result = poll_leopards_statuses(organization_id, job=job)

        job.checked_count = result.get("checked", job.checked_count)
        job.updated_count = result.get("updated", job.updated_count)
        job.status = "cancelled" if result.get("cancelled") else "completed"
        job.finished_at = timezone.now()
        _save_progress(job, ["checked_count", "updated_count", "status", "finished_at", "updated_at"])
    except Exception as exc:  # noqa: BLE001 - unsupervised background thread, must not vanish silently
        logger.exception("leopards sync job %s failed for org %s", job_id, organization_id)
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
