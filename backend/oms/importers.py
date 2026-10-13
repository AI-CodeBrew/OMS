"""CSV import of courier/settlement sheets onto existing orders.

Separate module rather than living in views: parsing, matching and the
dry-run preview are all pure-ish logic worth testing and reusing, and the
view should only be doing HTTP.

Two kinds of sheet. Neither ever creates an order - both only fill in what
the courier knows and our pipeline does not (real delivery outcome,
consignment number, carrier, ...):

- The courier aggregator's export (the "generic" sheet below), keyed by the
  store's own order number, carrying a settlement sheet's delivery charges
  and invoice reference too.
- A courier's own portal export - Smartlane, PostEx or BarqRaftar, exactly
  as their portals download it (COURIER_SHEETS); the user says which one it
  is. This is how a new store's history gets out of New: every order synced
  from Shopify starts there, while the courier already knows what became of
  each one.
"""

import csv
import io
import re
import zoneinfo
from collections import Counter
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from core.events import publish_event

from .models import Courier, Order, OrderItem, OrderStatusEvent

# The sheets carry wall-clock local time with no offset, while the project
# runs on UTC - reading them as UTC would shift every date by the offset.
# The couriers here are Pakistani, hence the default.
SHEET_TIMEZONE = zoneinfo.ZoneInfo(getattr(settings, "COURIER_SHEET_TIMEZONE", "Asia/Karachi"))

# Placeholder the export uses for "no value".
_BLANK = {"", "--", "-", "n/a", "na", "null", "none"}

# What a stage column (Smartlane's "Delivered At", ...) holds for a stage
# that hasn't happened yet, besides a blank.
_NOT_HAPPENED = {"0", "no", "false", "0000-00-00", "0000-00-00 00:00:00"}

# Sorts before every real date - a row with no date loses to one with any.
_EARLIEST = datetime.min.replace(tzinfo=dt_timezone.utc)

# "15 Aug 2026, 2:33 PM" - the only shape seen in these exports, with a
# couple of tolerant fallbacks so a slightly different export still loads.
# ISO dates ("2026-08-15 14:33:00") are read before any of these.
_DATE_FORMATS = (
    "%d %b %Y, %I:%M %p",
    "%d %B %Y, %I:%M %p",
    "%d %b %Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
    # What Excel writes when a hand-kept sheet is saved as CSV - day first,
    # as everywhere in Pakistan.
    "%d/%m/%Y %I:%M %p",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
    "%d-%m-%Y",
    # The couriers' own portal exports. None of them documents its format,
    # so the common shapes are all accepted.
    "%Y-%m-%d %I:%M %p",
    "%Y-%m-%d %I:%M:%S %p",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d",
    "%d/%m/%Y %I:%M:%S %p",
    "%d-%m-%Y %H:%M:%S",
    "%d-%m-%Y %H:%M",
    "%d-%m-%Y %I:%M %p",
    "%d-%b-%Y",
    "%d-%b-%y",
    "%d-%b-%Y %H:%M:%S",
    "%d-%b-%Y %I:%M %p",
    "%d %b %Y %I:%M %p",
    "%d %b %Y %H:%M",
    "%d %B %Y",
    "%b %d, %Y",
    "%b %d, %Y %I:%M %p",
    "%B %d, %Y",
    "%B %d, %Y %I:%M %p",
    # Month first - only reached when day-first can't read it (a "13" or
    # more up front), e.g. a sheet saved by a US-locale Excel.
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y",
)

# Courier status text -> our pipeline status. Matched case-insensitively
# after whitespace collapsing.
STATUS_MAP = {
    "return to shipper": "returned",
    "returned to shipper": "returned",
    "returned": "returned",
    "return": "returned",
    "return received": "returned",
    "rto": "returned",
    "rts": "returned",
    "delivered": "delivered",
    "complete": "delivered",
    "completed": "delivered",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "booked": "dispatched",
    "dispatched": "dispatched",
    "shipped": "dispatched",
    "picked": "dispatched",
    "picked up": "dispatched",
    "in transit": "dispatched",
    "intransit": "dispatched",
    "out for delivery": "out_for_delivery",
    "attempted": "attempt",
    "delivery attempted": "attempt",
    "delivery failed": "attempt",
    "undelivered": "attempt",
}

# Statuses that only say "the parcel is moving". Unlike the final ones they
# are often stale in an old sheet, so they may only move an order forward:
# never back from a later stage, never over a final outcome.
_IN_TRANSIT = {"dispatched", "out_for_delivery", "attempt"}
_TRANSIT_RANK = {"dispatched": 1, "out_for_delivery": 2, "attempt": 2}

# Courier sheets write the carrier every way ("Burq Raftar", "barq_raftar",
# "POSTEX") - each would become its own Courier row, and only the canonical
# BarqRaftar / PostEx rows are ones their pollers adopt. Keyed by the name's
# letters alone; anything not listed is kept as written.
_COURIER_CANONICAL = {
    "postex": "PostEx",
    "smartlane": "Smartlane",
    "omscourier": "OMS Courier",
    "tcs": "TCS",
    "trax": "Trax",
    "leopard": "Leopards",
    "leopards": "Leopards",
    "leopardscourier": "Leopards",
    "mnp": "MNP",
    "mandp": "MNP",
    "lama": "Lama",
    "dex": "DEX",
    "fastex": "Fastex",
    "qwqer": "Qwqer",
    "tez": "Tez",
}

# Header -> internal key. Lower-cased and stripped before lookup so
# capitalisation/spacing differences between exports don't matter.
COLUMN_ALIASES = {
    "web orderid": "order_number",
    "web order id": "order_number",
    "order id": "order_number",
    "order no": "order_number",
    "order number": "order_number",
    "order date": "order_date",
    "booking date": "booking_date",
    "cod amount": "cod_amount",
    "courier": "courier",
    "cn": "cn",
    "consignment": "cn",
    "consignment number": "cn",
    "consignment no": "cn",
    "tracking": "cn",
    "tags": "tags",
    "tag": "tags",
    "status": "status",
    "invoice no": "invoice_number",
    "invoice number": "invoice_number",
    "invoice": "invoice_number",
    "payment status": "payment_status",
    "delivery charges": "delivery_charges",
    "delivery charge": "delivery_charges",
    "shipping charges": "delivery_charges",
    "phone": "phone",
    "customer phone": "phone",
    "phone number": "phone",
    "contact": "phone",
    "contact number": "phone",
    "contact no": "phone",
    "consignee contact": "phone",
    "consignee phone": "phone",
    "mobile": "phone",
    "mobile number": "phone",
    "mobile no": "phone",
    "cell": "phone",
    "product": "product_name",
    "product name": "product_name",
    "products": "product_name",
    "item": "product_name",
    "item name": "product_name",
    "line items": "product_name",
}

# The store's own order number. When a sheet carries one of these beside a
# generic "Order ID", the generic one is the aggregator's internal id and
# must not be matched against our orders.
_WEB_ORDER_HEADERS = {"web orderid", "web order id"}


def _clean(value):
    value = (value or "").strip()
    return "" if value.lower() in _BLANK else value


def _parse_decimal(value):
    """'3,749' -> Decimal('3749'); '--'/'' -> None."""
    raw = _clean(value).replace(",", "").replace("Rs", "").strip()
    if not raw:
        return None
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def _parse_datetime(value):
    raw = _clean(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        parsed = None
    if parsed is None:
        for fmt in _DATE_FORMATS:
            try:
                parsed = datetime.strptime(raw, fmt)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return parsed.replace(tzinfo=SHEET_TIMEZONE)
    return parsed


def _canonical_courier(name):
    """'Burq Raftar' / 'barq_raftar' -> 'BarqRaftar'; unknown names as-is."""
    name = _clean(name)
    letters = re.sub(r"[^a-z]", "", name.lower())
    if letters.startswith(("barq", "burq")):
        return "BarqRaftar"
    return _COURIER_CANONICAL.get(letters, name)


def _normalize_phone(value):
    """Keeps only the last 10 digits, so '+92 300 1234567', '923001234567'
    and '03001234567' all compare equal regardless of country-code/leading
    zero formatting. Under 7 digits is treated as no phone at all - too
    short to mean anything, and we'd rather leave a row unmatched than
    match on a near-empty key."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 7 else ""


def _order_number_variants(raw):
    """The sheets are inconsistent about the leading '#' (most rows have
    it, a handful don't), so try both spellings when matching."""
    value = _clean(raw)
    if not value:
        return []
    stripped = value.lstrip("#")
    return [number for number in dict.fromkeys([value, f"#{stripped}", stripped]) if number]


def _read_text(file_obj):
    raw = file_obj.read()
    if isinstance(raw, bytes):
        # utf-8-sig strips the BOM Excel writes, which would otherwise
        # corrupt the first header and break column matching.
        return raw.decode("utf-8-sig", errors="replace")
    return raw


def parse_rows(file_obj):
    """Reads the uploaded CSV into normalised dicts. Returns
    (rows, errors) - errors describe rows that couldn't be read at all."""
    # A plain reader rather than DictReader: aggregator exports repeat
    # headers ("Status", "Courier", ... once from the courier, again in a
    # hand-updated block further right), and DictReader keeps only the last
    # copy - blank cells included, which would wipe the earlier value.
    reader = csv.reader(io.StringIO(_read_text(file_obj)))
    headers = next(reader, None)
    if not headers:
        return [], ["The file appears to be empty."]

    names = [(name or "").strip().lower() for name in headers]
    has_web_order = any(name in _WEB_ORDER_HEADERS for name in names)
    columns = []
    for index, name in enumerate(names):
        key = COLUMN_ALIASES.get(name)
        if key == "order_number" and has_web_order and name not in _WEB_ORDER_HEADERS:
            continue
        if key:
            columns.append((index, key))

    if "order_number" not in {key for _index, key in columns}:
        return [], [
            "No order-number column found. Expected a column named "
            "'Web OrderID' (or 'Order No' / 'Order Number')."
        ]

    rows, errors = [], []
    for line_number, cells in enumerate(reader, start=2):
        if not any(cell.strip() for cell in cells):
            continue
        # Rightmost non-blank copy of a repeated column wins.
        row = {}
        for index, key in columns:
            value = cells[index] if index < len(cells) else ""
            if _clean(value):
                row[key] = value
        numbers = _order_number_variants(row.get("order_number"))
        if not numbers:
            errors.append(f"Line {line_number}: missing order number")
            continue
        rows.append(
            {
                "line": line_number,
                "order_number_variants": numbers,
                "display_number": numbers[0],
                "order_date": _parse_datetime(row.get("order_date")),
                "booking_date": _parse_datetime(row.get("booking_date")),
                "cod_amount": _parse_decimal(row.get("cod_amount")),
                "courier": _canonical_courier(row.get("courier")),
                "cn": _clean(row.get("cn")),
                "tags": _clean(row.get("tags")),
                "status": STATUS_MAP.get(
                    " ".join(_clean(row.get("status")).lower().split())
                ),
                "status_label": _clean(row.get("status"))[:100],
                "invoice_number": _clean(row.get("invoice_number")),
                "payment_status": _clean(row.get("payment_status")).lower(),
                "delivery_charges": _parse_decimal(row.get("delivery_charges")),
                "phone": _clean(row.get("phone")),
                "phone_digits": _normalize_phone(row.get("phone")),
                "product_name": _clean(row.get("product_name")),
            }
        )
    return rows, errors


def _order_date_matches(order, target_date):
    """Same calendar day, compared in the sheet's timezone - placed_at is
    stored in UTC, so comparing raw dates would misfire near midnight."""
    ref = order.placed_at or order.created_at
    if not ref:
        return False
    ref_local = timezone.localtime(ref, SHEET_TIMEZONE) if timezone.is_aware(ref) else ref
    return ref_local.date() == target_date


def _pick_candidate(candidates, product_name, order_date):
    """Narrows a phone match down to one order. A phone number alone can
    cover several orders from the same repeat customer, so with more than
    one candidate this only commits when either the product name or the
    order date picks out exactly one of them - otherwise it's left
    unmatched rather than risk updating the wrong order.

    Tries product name first (when the sheet has one), then falls back to
    order date - most courier sheets carry a date but not a product name,
    so date is the fallback that actually gets used in practice.
    """
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) <= 1:
        return None

    pool = candidates
    if product_name:
        needle = product_name.lower()
        narrowed = [
            order
            for order in pool
            if any(
                needle in (item.product_name or "").lower()
                or (item.product_name or "").lower() in needle
                for item in order.items.all()
            )
        ]
        if len(narrowed) == 1:
            return narrowed[0]
        if narrowed:
            pool = narrowed

    if order_date:
        target = order_date.date()
        narrowed = [order for order in pool if _order_date_matches(order, target)]
        if len(narrowed) == 1:
            return narrowed[0]

    return None


def _match_orders(organization_id, rows):
    """Primary match is order number - one query for every candidate,
    avoiding a per-row lookup across a sheet of several thousand rows.

    Anything left over gets a second pass on phone number (narrowed by
    product name when needed): the sheets are normally keyed by our own
    order number, but a handful of rows - a different fulfilment channel,
    a typo'd id - carry a number that was never in our orders table, and
    the sheet's phone/product columns are enough to place them anyway.
    """
    wanted_numbers = {n for row in rows for n in row["order_number_variants"]}
    by_number = {
        order.order_number: order
        for order in Order.all_objects.filter(
            organization_id=organization_id, order_number__in=wanted_numbers
        )
    }

    matches, unresolved = [], []
    claimed_ids = set()
    for row in rows:
        order = next(
            (by_number[n] for n in row["order_number_variants"] if n in by_number), None
        )
        if order is not None:
            matches.append((row, order, "order_number"))
            claimed_ids.add(order.id)
        else:
            unresolved.append(row)

    phone_rows = [row for row in unresolved if row["phone_digits"]]
    if phone_rows:
        wanted_phones = {row["phone_digits"] for row in phone_rows}
        phone_index = {}
        candidates = Order.all_objects.filter(organization_id=organization_id).prefetch_related(
            Prefetch("items", queryset=OrderItem.all_objects.filter(organization_id=organization_id))
        )
        for order in candidates.iterator(chunk_size=500):
            digits = _normalize_phone(order.customer_phone)
            if digits in wanted_phones:
                phone_index.setdefault(digits, []).append(order)

        still_unresolved = []
        for row in unresolved:
            options = [
                o for o in phone_index.get(row["phone_digits"], []) if o.id not in claimed_ids
            ]
            order = (
                _pick_candidate(options, row["product_name"], row["order_date"])
                if options
                else None
            )
            if order is not None:
                matches.append((row, order, "phone"))
                claimed_ids.add(order.id)
            else:
                still_unresolved.append(row)
        unresolved = still_unresolved

    return matches, unresolved


# Statuses whose outcome is already final on our side - an import must not
# quietly rewrite them, so they're reported for review instead.
_PROTECTED = {"delivered", "returned", "cancelled"}


def _fmt(value):
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _unmatched_row_export(row):
    """Plain-JSON shape of an unresolved row for the "download unmatched
    as CSV" button - the original sheet's own fields, so the user can see
    exactly what didn't match and why (built client-side from this, no
    second upload needed)."""
    return {
        "order_number": row["display_number"],
        "order_date": _fmt(row["order_date"]),
        "courier": row["courier"],
        "cn": row["cn"],
        "invoice_number": row["invoice_number"],
        "payment_status": row["payment_status"],
        "delivery_charges": _fmt(row["delivery_charges"]),
        "tags": row["tags"],
        "phone": row["phone"],
        "product_name": row["product_name"],
    }


def _row_changes(row, order, courier_lookup):
    """Field updates this row implies for this order, skipping anything
    the sheet doesn't carry."""
    changes = {}

    if _status_applies(row["status"], order.status):
        changes["status"] = row["status"]
        if row["status"] == "returned" and not order.returned_at:
            changes["returned_at"] = row["booking_date"] or timezone.now()
        if row["status"] == "delivered" and not order.delivered_at:
            changes["delivered_at"] = row["booking_date"] or timezone.now()
    # Fill-only, like placed_at below: the booking is when the parcel left,
    # for any order the sheet shows as having gone out.
    final_status = changes.get("status", order.status)
    if (
        row["booking_date"]
        and not order.dispatched_at
        and final_status in _IN_TRANSIT | {"delivered", "returned"}
    ):
        changes["dispatched_at"] = row["booking_date"]

    if row["cn"] and order.tracking_number != row["cn"]:
        changes["tracking_number"] = row["cn"][:100]
    if row["tags"] and order.tag != row["tags"]:
        changes["tag"] = row["tags"][:100]
    if row["invoice_number"] and order.invoice_number != row["invoice_number"]:
        changes["invoice_number"] = row["invoice_number"][:100]
    # The courier's charge, kept out of the order total (Order.courier_charges).
    if row["delivery_charges"] is not None and order.courier_charges != row["delivery_charges"]:
        changes["courier_charges"] = row["delivery_charges"]
    # Fill-only: an order synced from Shopify already has an exact UTC
    # placed_at, and the sheet's date is wall-clock with no offset - so it
    # backfills orders that never got one rather than overwriting good data.
    if row["order_date"] and not order.placed_at:
        changes["placed_at"] = row["order_date"]
    if row["payment_status"] in ("paid", "unpaid"):
        wanted = "paid" if row["payment_status"] == "paid" else "pending"
        if order.payment_status != wanted:
            changes["payment_status"] = wanted

    courier_name = row["courier"]
    if courier_name:
        courier = courier_lookup.get(courier_name.lower())
        if courier and order.courier_id != courier.id:
            changes["courier_id"] = courier.id

    # The sheet's own status text as the orders list's Sub Status
    # (Order.courier_status) - unless it's behind what we already know.
    behind = (
        row["status"] and row["status"] != order.status and not _status_applies(row["status"], order.status)
    )
    if row["status_label"] and order.courier_status != row["status_label"] and not behind:
        changes["courier_status"] = row["status_label"]

    return changes


def _status_applies(incoming, current):
    if not incoming or incoming == current:
        return False
    if incoming not in _IN_TRANSIT:
        return True
    if current in _PROTECTED:
        return False
    return _TRANSIT_RANK[incoming] > _TRANSIT_RANK.get(current, 0) or (
        current in _IN_TRANSIT and _TRANSIT_RANK[incoming] == _TRANSIT_RANK[current]
    )


def _courier_lookup(organization_id, rows, create_missing):
    names = {row["courier"] for row in rows if row["courier"]}
    existing = {}
    # An older import may have left "Burq Raftar" beside "BarqRaftar" - both
    # resolve to the canonical key, and the canonically named row wins.
    for c in Courier.all_objects.filter(organization_id=organization_id):
        key = _canonical_courier(c.name).lower()
        if key not in existing or c.name.lower() == key:
            existing[key] = c
    if create_missing:
        for name in names:
            if name.lower() not in existing:
                existing[name.lower()] = Courier.all_objects.create(
                    organization_id=organization_id, name=name[:150], is_active=True
                )
    return existing


# ------------------------------------------------------- Courier exports --
# A courier's own portal export, as downloaded. The column names are exactly
# what each portal writes (case, quotes, underscores and spacing don't
# matter - see _header_key); unlisted columns are ignored. Each listed
# column is read into a row key:
#   order_ref, cn                 the order number it was booked under, and
#                                 the consignment (tracking) number
#   status, status_alt, journey   status text - see "status_sources"
#   <stage>_at                    when the parcel reached that stage:
#                                 Smartlane has a column per stage, the
#                                 others a pickup / delivery / return date
#   status_at                     when the current status was reached
#   booking_date, transaction_date
#   customer_name, phone, address, product_name, cod_amount
#                                 place a row whose order number isn't ours
#                                 (_match_by_details)
#   city, payment_status, invoice_number, reason, remarks
#
# "status_sources" are where a row's stage comes from, most trusted first.
# When they disagree the furthest along wins (_resolve_stage). "sub_status"
# is where the courier's own word for it comes from - Order.courier_status.
COURIER_SHEETS = {
    "smartlane": {
        "label": "Smartlane",
        "columns": [
            ("Store Order Id", "order_ref"),
            ("Consignment Number", "cn"),
            ("SL Status", "status"),
            ("Booked At", "booked_at"),
            ("Dispatched At", "dispatched_at"),
            ("Out For Delivery", "out_for_delivery_at"),
            ("Attempted At", "attempt_at"),
            ("Delivered At", "delivered_at"),
            ("Return In Progress", "return_in_progress_at"),
            ("Returned At", "returned_at"),
            ("Cancelled At", "cancelled_at"),
            ("Courier Status", "status_alt"),
            ("Consignee Name", "customer_name"),
            ("Amount", "cod_amount"),
            ("Consignee City", "city"),
            ("Consignee Phone", "phone"),
            ("Consignee Address", "address"),
            ("Product Name", "product_name"),
        ],
        # "dates" is the per-stage columns - the same signal integrations.
        # services trusts most in Smartlane's own API. "Courier Status" is
        # the carrier Smartlane routed it to, in that carrier's own words.
        "status_sources": ("status", "dates", "status_alt"),
        # The Sub Status: the carrier's own words, else Smartlane's.
        "sub_status": ("status_alt", "status"),
    },
    "postex": {
        "label": "PostEx",
        # Named after PostEx's own API fields - orderRefNumber,
        # transactionStatus, invoicePayment (the COD amount), orderDetail.
        "columns": [
            ("ORDER_REFERENCE_NUMBER", "order_ref"),
            ("TRACKING_NUMBER", "cn"),
            ("TRANSACTION_DATE", "transaction_date"),
            ("MERCHANT_TRANSACTION_STATUS", "status"),
            ("CUSTOMER_NAME", "customer_name"),
            ("CUSTOMER_PHONE", "phone"),
            ("CITY_NAME", "city"),
            ("DELIVERY_ADDRESS", "address"),
            ("ORDER_DETAIL", "product_name"),
            ("INVOICE_PAYMENT", "cod_amount"),
            ("ORDER_PICKUP_DATE", "dispatched_at"),
            ("ORDER_DELIVERY_DATE", "delivered_at"),
            ("REVERSAL_DATE", "returned_at"),
            ("BOOKING_AT", "booking_date"),
            ("LAST_STATUS_CHANGED_DATE", "status_at"),
            ("JOURNEY", "journey"),
        ],
        "status_sources": ("status", "journey"),
        "sub_status": ("status",),
    },
    "barqraftar": {
        "label": "BarqRaftar",
        # "Customer Reference" is BarqRaftar's customer_reference - the order
        # number the parcel was booked under.
        "columns": [
            ("Tracking Number", "cn"),
            ("Customer Name", "customer_name"),
            ("Customer Reference", "order_ref"),
            ("Customer Contact", "phone"),
            ("Customer Address", "address"),
            ("To City", "city"),
            ("COD Amount", "cod_amount"),
            ("Delivery Charges", "delivery_charges"),
            ("Payment Status", "payment_status"),
            ("Status", "status"),
            ("Booking Date", "booking_date"),
            ("Pickup Date", "dispatched_at"),
            ("Remarks", "remarks"),
            ("invoice Number", "invoice_number"),
            ("Current Status", "status_alt"),
            ("Current Status Date", "status_at"),
            ("Rider Reason", "reason"),
        ],
        # "Current Status" comes with its own date, so it's the fresher of
        # the two when they disagree.
        "status_sources": ("status_alt", "status"),
        "sub_status": ("status_alt", "status"),
        # BarqRaftar's "Dispatched" is the rider leaving with the parcel -
        # out for delivery, not "shipped" (status id 4 in integrations/
        # barqraftar/services.py).
        "text_overrides": {"dispatched": "out_for_delivery"},
        # Its numeric status ids, should the sheet carry those instead -
        # local copy of the same table in integrations/barqraftar/services.py.
        "status_codes": {
            1: "booked", 2: "booked",
            3: "dispatched", 30: "dispatched", 31: "dispatched", 32: "dispatched",
            4: "out_for_delivery",
            5: "attempt", 6: "attempt", 7: "attempt", 14: "attempt",
            8: "return_in_progress", 10: "return_in_progress", 11: "return_in_progress",
            12: "return_in_progress", 13: "return_in_progress",
            9: "delivered",
            98: "returned",
            99: "cancelled",
        },
    },
}

# Courier status text -> stage, for all three couriers (their own words are
# collected in integrations/services.py, postex/services.py and
# barqraftar/services.py). Compared after _status_text, so "out_for_delivery"
# and "Out For Delivery" are the same.
_STAGE_BY_TEXT = {
    # Booked - the courier has it, nobody has picked it up yet.
    "booked": "booked",
    "unbooked": "booked",
    "order booked": "booked",
    "pending": "booked",
    "queue": "booked",
    "queued": "booked",
    "ready": "booked",
    "awaiting pickup": "booked",
    "ready for pickup": "booked",
    "pickup requested": "booked",
    # On the move.
    "dispatch": "dispatched",
    "dispatched": "dispatched",
    "shipped": "dispatched",
    "picked": "dispatched",
    "picked up": "dispatched",
    "picked by postex": "dispatched",
    "in transit": "dispatched",
    "intransit": "dispatched",
    "postex warehouse": "dispatched",
    "in stock": "dispatched",
    "transferred": "dispatched",
    "received at fc": "dispatched",
    "rfc origin": "dispatched",
    "waiting for delivery": "dispatched",
    # With the rider.
    "out for delivery": "out_for_delivery",
    "delivery en-route": "out_for_delivery",
    "delivery en route": "out_for_delivery",
    "enroute for delivery": "out_for_delivery",
    # Tried and not delivered - usually tried again.
    "attempt": "attempt",
    "attempted": "attempt",
    "delivery attempted": "attempt",
    "delivery failed": "attempt",
    "undelivered": "attempt",
    "delivery under review": "attempt",
    "under verification": "attempt",
    "merchant request for return": "attempt",
    "return by consignee": "attempt",
    "re-attempt requested": "attempt",
    "re attempt requested": "attempt",
    "re-attempt approval": "attempt",
    "re attempt approval": "attempt",
    "hold requested": "attempt",
    # Coming back - not final until the courier says it's returned.
    "return in progress": "return_in_progress",
    "return requested": "return_in_progress",
    "return transit": "return_in_progress",
    "return in transit": "return_in_progress",
    "return in-transit": "return_in_progress",
    "return confirmation": "return_in_progress",
    "rfc origin (return)": "return_in_progress",
    "return rfc origin": "return_in_progress",
    "out for return": "return_in_progress",
    "waiting for return": "return_in_progress",
    "return process initiated": "return_in_progress",
    "en route to merchant warehouse": "return_in_progress",
    "being return": "return_in_progress",
    "being returned": "return_in_progress",
    # Final.
    "delivered": "delivered",
    "delivered to customer": "delivered",
    "complete": "delivered",
    "completed": "delivered",
    "returned": "returned",
    "return": "returned",
    "returned to shipper": "returned",
    "return to shipper": "returned",
    "returned to origin": "returned",
    "returned to merchant": "returned",
    "returned at merchant warehouse": "returned",
    "return received": "returned",
    "return delivered": "returned",
    "rto": "returned",
    "rts": "returned",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "cancel": "cancelled",
    "un-assigned by me": "cancelled",
    "unassigned by me": "cancelled",
}

# Statuses the courier fills in per parcel ("En-Route to Lahore warehouse",
# "Attempt Made: customer not responding"), checked when no exact text
# above matched.
_STAGE_BY_PREFIX = (
    ("en-route to", "dispatched"),
    ("en route to", "dispatched"),
    ("enroute to", "dispatched"),
    ("arrived at", "dispatched"),
    ("departed to", "dispatched"),
    ("received at", "dispatched"),
    ("at postex", "dispatched"),
    ("attempt made", "attempt"),
    ("return to", "return_in_progress"),
)

# How far along each stage is. A courier's data only ever moves forward, so
# when a row's columns disagree the furthest one is the latest truth.
_STAGE_RANK = {
    "booked": 1,
    "dispatched": 2,
    "out_for_delivery": 3,
    "attempt": 3,
    "return_in_progress": 4,
    "delivered": 9,
    "returned": 9,
    "cancelled": 9,
}

# The OMS status each stage puts an order in. A parcel on its way back is
# still moving until the courier reports it returned -
# Order.return_in_progress_at records that it has turned around.
_STAGE_TARGET = {
    "booked": "ready_to_print",
    "dispatched": "dispatched",
    "return_in_progress": "dispatched",
    "out_for_delivery": "out_for_delivery",
    "attempt": "attempt",
    "delivered": "delivered",
    "returned": "returned",
    "cancelled": "cancelled",
}

# Smartlane's per-stage columns, furthest along first.
_STAGE_DATE_KEYS = (
    ("delivered", "delivered_at"),
    ("returned", "returned_at"),
    ("cancelled", "cancelled_at"),
    ("return_in_progress", "return_in_progress_at"),
    ("attempt", "attempt_at"),
    ("out_for_delivery", "out_for_delivery_at"),
    ("dispatched", "dispatched_at"),
    ("booked", "booked_at"),
)
_STAGE_DATE_KEY = dict(_STAGE_DATE_KEYS)

# Where an OMS status sits in the pipeline, for the statuses a courier
# sheet can move an order to or past. Pre-booking statuses (new, pending_*,
# city_issue, awaiting_*, approved) are 0; final ones are _PROTECTED.
_PIPELINE_RANK = {
    "booking_pending": 1,
    "ready_to_print": 2,
    "ready_to_pick": 3,
    "awaiting_dispatched": 3,
    "dispatch_issue": 3,
    "dispatched": 4,
    "out_for_delivery": 5,
    "attempt": 5,
}

# Where each OMS status sits among the courier stages (_STAGE_RANK) - pre-
# booking statuses are 0.
_STATUS_STAGE_RANK = {
    "booking_pending": 1,
    "ready_to_print": 1,
    "ready_to_pick": 1,
    "awaiting_dispatched": 1,
    "dispatch_issue": 1,
    "dispatched": 2,
    "out_for_delivery": 3,
    "attempt": 3,
    "delivered": 9,
    "returned": 9,
    "cancelled": 9,
}

# Statuses for which the parcel has left the warehouse.
_SENT_STATUSES = {"dispatched", "out_for_delivery", "attempt", "delivered", "returned"}

# Every courier sheet needs both - they're what tells one courier's export
# apart from another's.
_REQUIRED_KEYS = ("order_ref", "cn")

# Dry-run placeholder for a sheet's Courier row that only a real import
# creates - a preview must not leave rows behind.
_NEW_COURIER = "new"

_JOURNEY_SPLIT = re.compile(r"->|=>|→|>|\||;|,|\n")
_WORD = re.compile(r"[a-z0-9]+")


def _header_key(name):
    """'MERCHANT_TRANSACTION_STATUS' / '"invoice Number"' ->
    'merchant transaction status' / 'invoice number'."""
    cleaned = (name or "").replace("﻿", "").strip().strip('"').replace("_", " ")
    return " ".join(cleaned.lower().split())


def _status_text(value):
    """'Out_For_Delivery ' -> 'out for delivery'."""
    return " ".join(_clean(value).lower().replace("_", " ").split())


def _happened(value):
    """Whether a stage column says the stage happened - a date (or any
    other mark), not blank and not a zero date."""
    value = _clean(value)
    return bool(value) and value.lower() not in _NOT_HAPPENED


def _text_stage(sheet, value):
    text = _status_text(value)
    if not text:
        return None
    if text.isdigit():
        return sheet.get("status_codes", {}).get(int(text))
    if text in sheet.get("text_overrides", {}):
        return sheet["text_overrides"][text]
    stage = _STAGE_BY_TEXT.get(text)
    if stage:
        return stage
    return next((s for prefix, s in _STAGE_BY_PREFIX if text.startswith(prefix)), None)


def _journey_stage(sheet, value):
    """BarqRaftar's journey lists every status the parcel went through.
    Whichever order it's written in, the furthest along is where it is now."""
    best = None
    for part in _JOURNEY_SPLIT.split(_clean(value)):
        # "Delivered (03-10-2026 16:40)" -> "Delivered"
        words = re.sub(r"\(.*?\)|\[.*?\]", " ", part).split()
        stage = _text_stage(sheet, " ".join(w for w in words if not any(c.isdigit() for c in w)).strip(" :-"))
        if stage and (best is None or _STAGE_RANK[stage] > _STAGE_RANK[best]):
            best = stage
    return best


def _stage_from_dates(raw):
    """Smartlane's per-stage columns -> (stage, when). Of the stages that
    happened the furthest along wins; between two equally far ones
    (delivered, then returned) the later date, else the first listed."""
    best = None
    for stage, key in _STAGE_DATE_KEYS:
        value = raw.get(key)
        if not _happened(value):
            continue
        when = _parse_datetime(value)
        candidate = (_STAGE_RANK[stage], when or _EARLIEST)
        if best is None or candidate > best[0]:
            best = (candidate, stage, when)
    return (best[1], best[2]) if best else (None, None)


def _stage_date(raw, stage):
    """When the row's parcel reached `stage`: that stage's own column if the
    sheet has one, else the date of its current status."""
    value = raw.get(_STAGE_DATE_KEY.get(stage, ""))
    when = _parse_datetime(value) if _happened(value) else None
    return when or _parse_datetime(raw.get("status_at"))


def _resolve_stage(sheet, raw):
    """(stage, when it was reached, the status text it was read from). The
    furthest-along source wins; between equally far ones, the more trusted
    (the sheet's status_sources order)."""
    best, best_when, label = None, None, ""
    for source in sheet["status_sources"]:
        when = None
        if source == "dates":
            stage, when = _stage_from_dates(raw)
        elif source == "journey":
            stage = _journey_stage(sheet, raw.get(source))
        else:
            label = label or _clean(raw.get(source))
            stage = _text_stage(sheet, raw.get(source))
        if stage and (best is None or _STAGE_RANK[stage] > _STAGE_RANK[best]):
            best, best_when = stage, when
    if best is None:
        return None, None, label
    return best, best_when or _stage_date(raw, best), label


def _courier_row(sheet, raw, line_number):
    ref = _clean(raw.get("order_ref")).lstrip("'")
    cn = _clean(raw.get("cn")).lstrip("'")
    if cn.lower().startswith("not assigned"):
        # Smartlane's placeholder until a real consignment number exists.
        cn = ""
    stage, stage_at, label = _resolve_stage(sheet, raw)
    return_marked = raw.get("return_in_progress_at")
    return {
        "line": line_number,
        "order_ref": ref,
        "order_number_variants": _order_number_variants(ref),
        "display_number": ref or cn,
        "cn": cn[:100],
        "stage": stage,
        "stage_at": stage_at,
        "status_label": label[:100],
        # The courier's own word for the orders list's Sub Status
        # (Order.courier_status).
        "sub_status": next((v for v in (_clean(raw.get(k)) for k in sheet["sub_status"]) if v), "")[:100],
        "return_in_progress": stage == "return_in_progress" or _happened(return_marked),
        "return_in_progress_at": _parse_datetime(return_marked)
        or (stage_at if stage == "return_in_progress" else None),
        "dispatched_at": _parse_datetime(raw.get("dispatched_at")),
        "booking_date": _parse_datetime(raw.get("booking_date"))
        or _parse_datetime(raw.get("booked_at"))
        or _parse_datetime(raw.get("transaction_date")),
        "customer_name": _clean(raw.get("customer_name")),
        "phone": _clean(raw.get("phone")).lstrip("'"),
        "phone_digits": _normalize_phone(raw.get("phone")),
        "address": _clean(raw.get("address")),
        "city": _clean(raw.get("city")),
        "product_name": _clean(raw.get("product_name")),
        "cod_amount": _parse_decimal(raw.get("cod_amount")),
        "delivery_charges": _parse_decimal(raw.get("delivery_charges")),
        "payment_status": _clean(raw.get("payment_status")).lower(),
        "invoice_number": _clean(raw.get("invoice_number")),
        "reason": _clean(raw.get("reason")) or _clean(raw.get("remarks")),
    }


def _sheet_columns(sheet, header_keys):
    """[(column index, row key)] for the header columns `sheet` reads."""
    lookup = {_header_key(label): key for label, key in sheet["columns"]}
    return [(index, lookup[key]) for index, key in enumerate(header_keys) if key in lookup]


def _status_keys(sheet):
    keys = set()
    for source in sheet["status_sources"]:
        keys |= set(_STAGE_DATE_KEY.values()) if source == "dates" else {source}
    return keys


def _sheet_fits(sheet, header_keys):
    keys = {key for _index, key in _sheet_columns(sheet, header_keys)}
    return set(_REQUIRED_KEYS) <= keys and bool(keys & _status_keys(sheet))


def _wrong_sheet_message(courier, header_keys):
    sheet = COURIER_SHEETS[courier]
    keys = {key for _index, key in _sheet_columns(sheet, header_keys)}
    status_keys = _status_keys(sheet)
    missing = [label for label, key in sheet["columns"] if key in _REQUIRED_KEYS and key not in keys]
    if not keys & status_keys:
        missing.append(next(label for label, key in sheet["columns"] if key in status_keys))
    message = f"This doesn't look like {sheet['label']}'s export - it has no {' / '.join(missing)} column."
    for other in COURIER_SHEETS.values():
        if other is not sheet and _sheet_fits(other, header_keys):
            return f"{message} It looks like {other['label']}'s - import it as {other['label']} instead."
    return message


def parse_courier_rows(file_obj, courier):
    """Reads a courier's own export (COURIER_SHEETS[courier]) into
    normalised row dicts. Returns (rows, errors)."""
    sheet = COURIER_SHEETS[courier]
    reader = csv.reader(io.StringIO(_read_text(file_obj)))
    headers = next(reader, None)
    if not headers:
        return [], ["The file appears to be empty."]
    header_keys = [_header_key(name) for name in headers]
    if not _sheet_fits(sheet, header_keys):
        return [], [_wrong_sheet_message(courier, header_keys)]

    columns = _sheet_columns(sheet, header_keys)
    rows, errors = [], []
    for line_number, cells in enumerate(reader, start=2):
        if not any(cell.strip() for cell in cells):
            continue
        raw = {}
        for index, key in columns:
            value = cells[index] if index < len(cells) else ""
            if _clean(value):
                raw[key] = value
        row = _courier_row(sheet, raw, line_number)
        if not row["order_ref"] and not row["cn"]:
            errors.append(f"Line {line_number}: no order reference or tracking number")
            continue
        rows.append(row)
    return rows, errors


def _words(value):
    return _WORD.findall((value or "").lower())


def _same_name(sheet_name, order_name):
    """Same words in any order; a fuller name on one side still counts when
    the shorter one has at least two words ("Ali Khan" / "Ali Khan Niazi")."""
    a, b = set(_words(sheet_name)), set(_words(order_name))
    if not a or not b:
        return False
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    return a == b or (len(shorter) >= 2 and shorter <= longer)


def _same_address(sheet_address, order):
    """Couriers rewrite addresses (city appended, cut short, punctuation
    dropped), so this compares words: nearly all of the shorter address has
    to appear in the other."""
    a = set(_words(f"{order.address_line1} {order.address_line2}"))
    b = set(_words(sheet_address))
    if not a or not b:
        return False
    shared = len(a & b)
    return a == b or (shared >= 2 and shared / min(len(a), len(b)) >= 0.8)


def _product_words(value):
    # Single characters are sizes and quantities ("M", "2 x"), not the product.
    return {word for word in _words(value) if len(word) > 1}


def _same_product(sheet_product, order):
    """One of the row's products ("2 x Black Hoodie, 1 x Cap") is one of the
    order's items - compared by words, either way round, so a size on one
    side ("Black Hoodie - M") doesn't stop it."""
    items = [_product_words(item.product_name) for item in order.items.all()]
    for part in re.split(r"[,;|\n]", sheet_product):
        words = _product_words(part)
        if words and any(names and (words <= names or names <= words) for names in items):
            return True
    return False


def _placed(order):
    return order.placed_at or order.created_at


def _details_mismatch(row, order):
    """Why `order` can't be the row's, or None when every customer detail the
    row carries agrees with it - its phone already does, that's how it was
    found. An order already carrying another consignment number went out as
    a different parcel, and one placed after the parcel was booked can't be
    it (a day's slack for timezones and the portals' own clocks)."""
    if row["cn"] and order.tracking_number and order.tracking_number != row["cn"]:
        return "it has another tracking number"
    if row["booking_date"] and _placed(order) > row["booking_date"] + timedelta(days=1):
        return "it was placed after this booking"
    if not _same_name(row["customer_name"], order.customer_name):
        return "the name differs"
    if not _same_address(row["address"], order):
        return "the address differs"
    if row["product_name"] and not _same_product(row["product_name"], order):
        return "the product differs"
    return None


def _not_matched(row, kind, reason):
    """Marks why a row updated nothing - for the preview's breakdown (kind)
    and the "download unmatched" CSV (reason)."""
    row["unmatched_kind"] = kind
    row["unmatched_reason"] = reason


def _cod_matches(order, amount):
    return any(abs(value - amount) < 1 for value in (order.grand_total, order.amount_receivable))


def _narrow_candidates(row, pool):
    """The one order in `pool` the row is about, or None. A repeat customer
    can have several that agree on every detail - then the COD amount has
    to pick one out, or the row is left alone rather than guessed."""
    if len(pool) == 1:
        return pool[0]
    if pool and row["cod_amount"] is not None:
        narrowed = [order for order in pool if _cod_matches(order, row["cod_amount"])]
        if len(narrowed) == 1:
            return narrowed[0]
    return None


def _match_by_details(organization_id, orders, rows, claimed):
    """Places rows whose order reference and tracking number are both
    unknown here: an order with the row's phone number (or secondary phone)
    whose name and address - and product, when the sheet has one - agree
    too. Returns (matches, unresolved, ambiguous); each row left over says
    why (_not_matched)."""
    usable, unresolved = [], []
    for row in rows:
        if row["phone_digits"] and row["customer_name"] and row["address"]:
            usable.append(row)
        else:
            _not_matched(
                row, "no_details",
                "Order number and tracking number not in OMS, and the sheet has no phone, name "
                "and address to look for it by",
            )
            unresolved.append(row)
    if not usable:
        return [], unresolved, []

    # Phones are stored however Shopify/the store wrote them, so they can't
    # be compared in SQL - one narrow pass over (id, phones) instead.
    wanted = {row["phone_digits"] for row in usable}
    ids_by_phone, taken_by_phone = {}, {}
    phones = orders.values_list("id", "order_number", "customer_phone", "secondary_phone")
    for order_id, order_number, phone, secondary in phones.iterator(chunk_size=2000):
        for digits in {_normalize_phone(phone), _normalize_phone(secondary)}:
            if digits not in wanted:
                continue
            if order_id in claimed:
                # Already another row's - only worth naming if nothing else fits.
                taken_by_phone.setdefault(digits, []).append(order_number)
            else:
                ids_by_phone.setdefault(digits, set()).add(order_id)
    candidate_ids = set().union(*ids_by_phone.values())
    candidates = {
        order.id: order
        for order in orders.filter(id__in=candidate_ids).prefetch_related(
            Prefetch("items", queryset=OrderItem.all_objects.filter(organization_id=organization_id))
        )
    } if candidate_ids else {}

    wants, ambiguous = {}, []
    for row in usable:
        pool, misses = [], []
        for order_id in ids_by_phone.get(row["phone_digits"], ()):
            order = candidates.get(order_id)
            if order is None:
                continue
            miss = _details_mismatch(row, order)
            if miss is None:
                pool.append(order)
            else:
                misses.append(f"{order.order_number} ({miss})")
        order = _narrow_candidates(row, pool)
        if order is not None:
            wants.setdefault(order.id, []).append(row)
        elif pool:
            _not_matched(
                row, "ambiguous",
                "Matches more than one order: " + ", ".join(o.order_number for o in pool[:5]),
            )
            ambiguous.append(row)
        elif misses:
            _not_matched(
                row, "details_differ",
                "Order number not in OMS. Same phone: " + ", ".join(misses[:3]),
            )
            unresolved.append(row)
        elif taken_by_phone.get(row["phone_digits"]):
            _not_matched(
                row, "details_differ",
                "Order number not in OMS. The order with this phone ("
                + ", ".join(taken_by_phone[row["phone_digits"]][:3])
                + ") is already another row's",
            )
            unresolved.append(row)
        else:
            _not_matched(row, "not_in_oms", "Not in OMS - no order has this order number, tracking number or phone")
            unresolved.append(row)

    matches = []
    for order_id, wanting in wants.items():
        if len({row["cn"] for row in wanting if row["stage"] != "cancelled"}) <= 1:
            # One parcel, perhaps booked and cancelled before it - the same
            # order either way.
            matches += [(row, candidates[order_id], "details") for row in wanting]
        else:
            # Two live parcels point at the same order - can't tell which.
            for row in wanting:
                _not_matched(
                    row, "ambiguous",
                    f"{candidates[order_id].order_number} matches more than one parcel in the sheet",
                )
            ambiguous += wanting
    return matches, unresolved, ambiguous


def _match_courier_rows(organization_id, rows):
    """(matches, unresolved, ambiguous). A row is placed by, in order:

    1. its order reference - our order number (either '#' spelling), a
       Dispatch Hub booking's store-coded reference (Order.
       platform_reference), or Shopify's own order id, which couriers'
       Shopify apps can book under;
    2. its consignment number, when exactly one of our orders carries it;
    3. failing both, the customer's details (_match_by_details) - only
       ever onto a single order, never a guess between several.
    """
    orders = Order.all_objects.filter(organization_id=organization_id)
    numbers = {number for row in rows for number in row["order_number_variants"]}
    # Blank once a lone "#" is stripped - and a blank reference must never
    # meet the blank platform_reference every non-Hub order has.
    refs = {row["order_ref"].lstrip("#") for row in rows} - {""}
    # Shopify order ids are 13 digits today; a bigint holds up to 18 safely.
    shopify_ids = {int(ref) for ref in refs if ref.isdigit() and 10 <= len(ref) <= 18}
    cns = {row["cn"] for row in rows} - {""}

    by_number, by_reference, by_shopify_id, by_cn = {}, {}, {}, {}
    if numbers:
        by_number = {o.order_number: o for o in orders.filter(order_number__in=numbers)}
    if refs:
        for order in orders.filter(platform_reference__in=refs):
            by_reference.setdefault(order.platform_reference, order)
    if shopify_ids:
        by_shopify_id = {o.shopify_order_id: o for o in orders.filter(shopify_order_id__in=shopify_ids)}
    if cns:
        for order in orders.filter(tracking_number__in=cns):
            by_cn.setdefault(order.tracking_number, []).append(order)

    matches, unresolved = [], []
    for row in rows:
        ref = row["order_ref"].lstrip("#")
        order = next((by_number[n] for n in row["order_number_variants"] if n in by_number), None)
        if order is None and ref:
            order = by_reference.get(ref)
        if order is None and ref.isdigit():
            order = by_shopify_id.get(int(ref))
        if order is not None:
            matches.append((row, order, "order_number"))
        elif len(by_cn.get(row["cn"], ())) == 1:
            matches.append((row, by_cn[row["cn"]][0], "tracking"))
        else:
            unresolved.append(row)

    claimed = {order.id for _row, order, _via in matches}
    by_details, unresolved, ambiguous = _match_by_details(organization_id, orders, unresolved, claimed)
    return matches + by_details, unresolved, ambiguous


def _best_row_per_order(matches):
    """A parcel booked, cancelled and booked again leaves a row per booking
    - the order follows its latest live one (an unreadable status counts as
    live, a cancelled one only when there's nothing else)."""
    best = {}
    for row, order, matched_via in matches:
        liveness = 0 if row["stage"] == "cancelled" else (2 if row["stage"] else 1)
        key = (liveness, row["booking_date"] or _EARLIEST, row["line"])
        if order.id not in best or key > best[order.id][0]:
            best[order.id] = (key, row, order, matched_via)
    return [(row, order, matched_via) for _key, row, order, matched_via in best.values()]


def _courier_status_applies(target, current):
    """Whether `target` moves a not-yet-final order forward."""
    if not target or target == current:
        return False
    if target in _PROTECTED:
        return True
    rank, current_rank = _PIPELINE_RANK[target], _PIPELINE_RANK.get(current, 0)
    # Out for delivery and a failed attempt are the same stage - the
    # courier's newer word wins either way.
    return rank > current_rank or rank == current_rank == _PIPELINE_RANK["attempt"]


def _row_is_behind(row, order):
    """Whether the row reports a stage the order is already past - an export
    older than what the courier has told us since."""
    if row["stage"] is None:
        return False
    known = _STATUS_STAGE_RANK.get(order.status, 0)
    if order.return_in_progress_at and known in (_STAGE_RANK["dispatched"], _STAGE_RANK["attempt"]):
        known = _STAGE_RANK["return_in_progress"]
    return _STAGE_RANK[row["stage"]] < known


def _courier_row_changes(row, order, courier_id, overwrite_final):
    """(field updates, protected entry) for one courier-sheet row and its
    order. The status only ever moves forward, and a final outcome
    (delivered / returned / cancelled) is only replaced with overwrite_final
    - otherwise the order keeps it and is reported. Either way the order
    gets the row's tracking number and courier when it has none, and the
    courier's own word for the parcel as its Sub Status."""
    current = order.status
    target = _STAGE_TARGET.get(row["stage"])
    if target == "ready_to_print" and not row["cn"]:
        # Booked, but the courier hasn't given it a consignment number yet.
        target = "booking_pending"
    pre_booking = current not in _PROTECTED and current not in _PIPELINE_RANK
    if (
        target == "cancelled"
        and not pre_booking
        and row["cn"]
        and order.tracking_number
        and order.tracking_number != row["cn"]
    ):
        # A cancelled booking only cancels an order nothing else carries -
        # this one went out as another consignment.
        target = None

    behind = _row_is_behind(row, order)
    changes, conflict = {}, None
    if current in _PROTECTED:
        if target in _PROTECTED and target != current:
            if overwrite_final:
                changes["status"] = target
            else:
                conflict = {"order_number": order.order_number, "current": current, "incoming": target}
    elif not behind and _courier_status_applies(target, current):
        changes["status"] = target
    moved = "status" in changes
    status = changes.get("status", current)

    if moved:
        when = row["stage_at"] or row["booking_date"] or timezone.now()
        if status == "delivered" and not order.delivered_at:
            changes["delivered_at"] = when
        if status == "returned" and not order.returned_at:
            changes["returned_at"] = when
        if status == "returned" and row["reason"] and not order.return_reason:
            changes["return_reason"] = row["reason"][:255]
        sent_at = row["dispatched_at"] or row["booking_date"]
        if status in _SENT_STATUSES and sent_at and not order.dispatched_at:
            changes["dispatched_at"] = sent_at
    if conflict is None:
        if row["return_in_progress"] and status != "returned" and not order.return_in_progress_at:
            changes["return_in_progress_at"] = row["return_in_progress_at"] or row["stage_at"] or timezone.now()
        if row["invoice_number"] and order.invoice_number != row["invoice_number"]:
            changes["invoice_number"] = row["invoice_number"][:100]
        # The orders list's Delivery Charges - the courier's charge, kept out
        # of the order total, which stays the Shopify order's own
        # (Order.courier_charges).
        if row["delivery_charges"] is not None and order.courier_charges != row["delivery_charges"]:
            changes["courier_charges"] = row["delivery_charges"]
        # BarqRaftar's "Payment Status": whether it has paid the store the COD.
        if row["payment_status"] in ("paid", "settled") and order.payment_status != "paid":
            changes["payment_status"] = "paid"

    # What the order is missing comes from the row, conflict or not. Our
    # own tracking number stands once the order is past booking - the
    # courier integrations follow the parcel by it.
    if row["cn"] and order.tracking_number != row["cn"] and (
        not order.tracking_number or (pre_booking and row["stage"] != "cancelled")
    ):
        changes["tracking_number"] = row["cn"]
    # The courier whose export carries the order's own tracking number is
    # that parcel's courier - which also puts right one set wrong before (a
    # sheet imported under the wrong courier).
    tracking = changes.get("tracking_number", order.tracking_number)
    same_parcel = bool(row["cn"]) and tracking == row["cn"]
    if order.courier_id != courier_id and (not order.courier_id or moved or pre_booking or same_parcel):
        changes["courier_id"] = courier_id
    # The courier's word for the parcel the order carries (or that this row
    # just moved it on) - never one booked before it, and never a stage the
    # order is already past.
    if (
        row["sub_status"]
        and order.courier_status != row["sub_status"]
        and (moved or not row["cn"] or tracking == row["cn"])
        and not behind
    ):
        changes["courier_status"] = row["sub_status"]
    return changes, conflict


def _sheet_courier_id(organization_id, name, *, create):
    """The org's Courier row a courier sheet assigns - an older import's
    "Post Ex" counts, the canonically named row wins - or _NEW_COURIER
    in a preview when there's none yet."""
    found = None
    for courier in Courier.all_objects.filter(organization_id=organization_id):
        if _canonical_courier(courier.name) == name and (found is None or courier.name == name):
            found = courier
    if found:
        return found.id
    if not create:
        return _NEW_COURIER
    courier, _created = Courier.all_objects.get_or_create(
        organization_id=organization_id, name=name, defaults={"is_active": True}
    )
    return courier.id


def _courier_unmatched_export(row):
    """A courier-sheet row nothing was updated from, for the "download
    unmatched" CSV - its own key fields plus why it was left."""
    return {
        "order_number": row["display_number"],
        "cn": row["cn"],
        "status": row["status_label"],
        "customer_name": row["customer_name"],
        "phone": row["phone"],
        "address": row["address"],
        "city": row["city"],
        "product_name": row["product_name"],
        "booking_date": _fmt(row["booking_date"]),
        "reason": row.get("unmatched_reason", "Not found"),
    }


# ------------------------------------------------------- Shared plumbing --


def _change_summary(planned):
    """({new status: orders moved there}, how many of those left New).
    Read before _apply_planned, which moves the orders."""
    by_status, from_new, seen = Counter(), 0, set()
    for order, changes, _via in planned:
        if "status" in changes and order.id not in seen:
            seen.add(order.id)
            by_status[changes["status"]] += 1
            if order.status == "new":
                from_new += 1
    return dict(by_status), from_new


def _matched_row(order, matched_via, row, changes, *, file_status, protected, courier_names):
    """One matched order for the preview's list: the order as it is now
    (read before _apply_planned moves it), what the sheet says about it,
    and what the import changes."""
    shown = {}
    for key, value in changes.items():
        if key == "courier_id":
            key, value = "courier", courier_names.get(value, "")
        shown[key] = _fmt(value)
    return {
        "order_number": order.order_number,
        "sheet_ref": row["display_number"],
        "matched_via": matched_via,
        "customer_name": order.customer_name,
        "phone": order.customer_phone,
        "status": order.status,
        "file_status": file_status,
        "tracking_number": order.tracking_number,
        "file_tracking": row["cn"],
        "changes": shown,
        "protected": protected,
    }


def _apply_planned(organization_id, planned, *, source, actor_user_id=None):
    """Writes every planned change - one bulk UPDATE per 500 orders, plus
    the status history each status change gets - then refreshes the cached
    Orders tabs once for the whole sheet.

    Deliberately not oms.services' transitions order by order: a sheet can
    hold thousands of long-finished orders, and those would push every one
    to Shopify (fulfillment, tags) inside this request and take stock for
    parcels that left long ago. Orders it leaves on the move are still
    followed by their courier's poller, which adopts them by the tracking
    number filled in here (adopt_portal_bookings in integrations/postex
    and integrations/barqraftar)."""
    now = timezone.now()
    before = {}
    for order, _changes, _via in planned:
        before.setdefault(order.id, order.status)
    fields = {"updated_at"}
    for order, changes, _via in planned:
        for key, value in changes.items():
            setattr(order, key, value)
            fields.add(key)
        order.updated_at = now
    orders = list({order.id: order for order, _changes, _via in planned}.values())
    note = f"Imported from {source} sheet"
    events = [
        OrderStatusEvent(
            organization_id=organization_id,
            order_id=order.id,
            from_status=before[order.id],
            to_status=order.status,
            note=note,
            actor_user_id=actor_user_id,
        )
        for order in orders
        if order.status != before[order.id]
    ]
    with transaction.atomic():
        # Chunked so one enormous sheet doesn't build a single
        # multi-thousand-row UPDATE statement.
        Order.all_objects.bulk_update(orders, sorted(fields), batch_size=500)
        OrderStatusEvent.all_objects.bulk_create(events, batch_size=500)

    # One event for the whole sheet: drops the cached Orders tabs and counts
    # and tells open Orders pages to reload (core/realtime.py).
    publish_event("order.updated", {"organization_id": str(organization_id), "source": "import"})
    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=organization_id,
            action="order.import",
            summary=f"{source} sheet imported: {len(orders)} orders updated, {len(events)} moved",
            actor_user_id=actor_user_id,
            entity_type="order",
            metadata={"source": source, "updated": len(orders), "moved": len(events)},
        )
    except Exception:
        pass


def _empty_result(errors, courier=""):
    return {
        "courier": courier,
        "total_rows": 0,
        "matched": 0,
        "matched_by_phone": 0,
        "matched_by_tracking": 0,
        "matched_by_details": 0,
        "unmatched": 0,
        "ambiguous": 0,
        "to_update": 0,
        "unchanged": 0,
        "protected": 0,
        "by_status": {},
        "from_new": 0,
        "unknown_statuses": [],
        "errors": errors,
        "unmatched_samples": [],
        "unmatched_rows": [],
        "unmatched_reasons": {},
        "protected_samples": [],
        "matched_rows": [],
        "applied": False,
    }


def run_import(
    organization_id, file_obj, *, dry_run=True, overwrite_final=False, courier="", actor_user_id=None
):
    """Parses the sheet and (unless dry_run) applies it. `courier` names a
    courier's own export (a COURIER_SHEETS key); without one the sheet is
    the courier aggregator's.

    dry_run is the default on purpose: this rewrites status and money on
    live orders, and the caller should be able to see exactly what would
    change before committing to it.
    """
    if courier:
        return _run_courier_import(
            organization_id, file_obj, courier,
            dry_run=dry_run, overwrite_final=overwrite_final, actor_user_id=actor_user_id,
        )

    rows, errors = parse_rows(file_obj)
    if not rows:
        return _empty_result(errors)

    matches, unresolved = _match_orders(organization_id, rows)
    unmatched = [row["display_number"] for row in unresolved]
    # Couriers are only created for a real run - a preview must not leave
    # rows behind in the database.
    courier_lookup = _courier_lookup(organization_id, rows, create_missing=not dry_run)

    planned, protected, unchanged, matched_rows = [], [], 0, []
    courier_names = {c.id: c.name for c in courier_lookup.values()}
    for row, order, matched_via in matches:
        changes = _row_changes(row, order, courier_lookup)
        conflict = (
            not overwrite_final
            and order.status in _PROTECTED
            and row["status"]
            and row["status"] not in _IN_TRANSIT
            and order.status != row["status"]
        )
        if conflict:
            protected.append(
                {
                    "order_number": order.order_number,
                    "current": order.status,
                    "incoming": row["status"],
                }
            )
            # Its status stays; what it's missing still comes from the
            # sheet, and the sheet's word for the parcel as Sub Status.
            changes = {
                key: value
                for key, value in changes.items()
                if key == "courier_status"
                or (key == "tracking_number" and not order.tracking_number)
                or (key == "courier_id" and not order.courier_id)
            }
        matched_rows.append(
            _matched_row(
                order, matched_via, row, changes,
                file_status=row["status_label"], protected=bool(conflict), courier_names=courier_names,
            )
        )
        if changes:
            planned.append((order, changes, matched_via))
        elif not conflict:
            unchanged += 1

    by_status, from_new = _change_summary(planned)

    applied = False
    if not dry_run and planned:
        _apply_planned(organization_id, planned, source="Courier", actor_user_id=actor_user_id)
        applied = True

    return {
        **_empty_result(errors[:20]),
        "total_rows": len(rows),
        "matched": len(matches),
        "matched_by_phone": sum(1 for _row, _order, via in matches if via == "phone"),
        "unmatched": len(unmatched),
        "to_update": len(planned),
        "unchanged": unchanged,
        "protected": len(protected),
        "by_status": by_status,
        "from_new": from_new,
        "unmatched_samples": unmatched[:20],
        "unmatched_rows": [_unmatched_row_export(row) for row in unresolved],
        "protected_samples": protected[:20],
        "matched_rows": matched_rows,
        "applied": applied,
    }


def _run_courier_import(organization_id, file_obj, courier, *, dry_run, overwrite_final, actor_user_id):
    sheet = COURIER_SHEETS[courier]
    rows, errors = parse_courier_rows(file_obj, courier)
    if not rows:
        return _empty_result(errors, courier)

    matches, unresolved, ambiguous = _match_courier_rows(organization_id, rows)
    courier_id = _sheet_courier_id(organization_id, sheet["label"], create=not dry_run)

    planned, protected, unchanged, matched_rows = [], [], 0, []
    best = _best_row_per_order(matches)
    for row, order, matched_via in best:
        changes, conflict = _courier_row_changes(row, order, courier_id, overwrite_final)
        if conflict:
            protected.append(conflict)
        matched_rows.append(
            _matched_row(
                order, matched_via, row, changes,
                file_status=row["sub_status"] or row["status_label"],
                protected=conflict is not None,
                courier_names={courier_id: sheet["label"]},
            )
        )
        if changes:
            planned.append((order, changes, matched_via))
        elif not conflict:
            unchanged += 1

    by_status, from_new = _change_summary(planned)
    left = unresolved + ambiguous
    unknown = Counter(row["status_label"] for row in rows if row["stage"] is None and row["status_label"])

    applied = False
    if not dry_run and planned:
        _apply_planned(organization_id, planned, source=sheet["label"], actor_user_id=actor_user_id)
        applied = True

    return {
        **_empty_result(errors[:20], courier),
        "total_rows": len(rows),
        "matched": len(best),
        "matched_by_tracking": sum(1 for _row, _order, via in best if via == "tracking"),
        "matched_by_details": sum(1 for _row, _order, via in best if via == "details"),
        "unmatched": len(unresolved),
        "ambiguous": len(ambiguous),
        "to_update": len(planned),
        "unchanged": unchanged,
        "protected": len(protected),
        "by_status": by_status,
        "from_new": from_new,
        "unknown_statuses": [{"status": label, "count": count} for label, count in unknown.most_common(10)],
        "unmatched_samples": [row["display_number"] for row in unresolved[:20]],
        "unmatched_rows": [_courier_unmatched_export(row) for row in left],
        "unmatched_reasons": dict(Counter(row.get("unmatched_kind", "not_in_oms") for row in left)),
        "protected_samples": protected[:20],
        "matched_rows": matched_rows,
        "applied": applied,
    }
