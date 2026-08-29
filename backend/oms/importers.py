"""CSV import of courier/settlement sheets onto existing orders.

Separate module rather than living in views: parsing, matching and the
dry-run preview are all pure-ish logic worth testing and reusing, and the
view should only be doing HTTP.

The sheets are exports from the courier aggregator, keyed by the store's
own order number, so this never creates orders - it only fills in what
the courier knows and our pipeline does not (real delivery outcome,
consignment number, carrier, delivery charges, invoice reference).
"""

import csv
import io
import re
import zoneinfo
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from .models import Courier, Order, OrderItem

# The sheets carry wall-clock local time with no offset, while the project
# runs on UTC - reading them as UTC would shift every date by the offset.
# The couriers here are Pakistani, hence the default.
SHEET_TIMEZONE = zoneinfo.ZoneInfo(getattr(settings, "COURIER_SHEET_TIMEZONE", "Asia/Karachi"))

# Placeholder the export uses for "no value".
_BLANK = {"", "--", "-", "n/a", "na", "null", "none"}

# "15 Aug 2026, 2:33 PM" - the only shape seen in these exports, with a
# couple of tolerant fallbacks so a slightly different export still loads.
_DATE_FORMATS = (
    "%d %b %Y, %I:%M %p",
    "%d %B %Y, %I:%M %p",
    "%d %b %Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)

# Courier status text -> our pipeline status. Matched case-insensitively
# after whitespace collapsing.
STATUS_MAP = {
    "return to shipper": "returned",
    "returned": "returned",
    "return received": "returned",
    "rto": "returned",
    "delivered": "delivered",
    "complete": "delivered",
    "completed": "delivered",
    "cancelled": "cancelled",
    "canceled": "cancelled",
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
    "mobile": "phone",
    "mobile number": "phone",
    "mobile no": "phone",
    "cell": "phone",
    "product": "product_name",
    "product name": "product_name",
    "products": "product_name",
    "item": "product_name",
    "item name": "product_name",
}


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
    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        if timezone.is_naive(parsed):
            return parsed.replace(tzinfo=SHEET_TIMEZONE)
        return parsed
    return None


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
    return list(dict.fromkeys([value, f"#{stripped}", stripped]))


def parse_rows(file_obj):
    """Reads the uploaded CSV into normalised dicts. Returns
    (rows, errors) - errors describe rows that couldn't be read at all."""
    raw = file_obj.read()
    if isinstance(raw, bytes):
        # utf-8-sig strips the BOM Excel writes, which would otherwise
        # corrupt the first header and break column matching.
        text = raw.decode("utf-8-sig", errors="replace")
    else:
        text = raw

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], ["The file appears to be empty."]

    header_map = {}
    for name in reader.fieldnames:
        key = COLUMN_ALIASES.get((name or "").strip().lower())
        if key:
            header_map[name] = key

    if "order_number" not in header_map.values():
        return [], [
            "No order-number column found. Expected a column named "
            "'Web OrderID' (or 'Order No' / 'Order Number')."
        ]

    rows, errors = [], []
    for line_number, raw_row in enumerate(reader, start=2):
        row = {key: raw_row.get(name) for name, key in header_map.items()}
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
                "courier": _clean(row.get("courier")),
                "cn": _clean(row.get("cn")),
                "tags": _clean(row.get("tags")),
                "status": STATUS_MAP.get(
                    " ".join(_clean(row.get("status")).lower().split())
                ),
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


def _unmatched_row_export(row):
    """Plain-JSON shape of an unresolved row for the "download unmatched
    as CSV" button - the original sheet's own fields, so the user can see
    exactly what didn't match and why (built client-side from this, no
    second upload needed)."""

    def _fmt(value):
        if value is None:
            return ""
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)

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

    if row["status"] and order.status != row["status"]:
        changes["status"] = row["status"]
        if row["status"] == "returned" and not order.returned_at:
            changes["returned_at"] = row["booking_date"] or timezone.now()
        if row["status"] == "delivered" and not order.delivered_at:
            changes["delivered_at"] = row["booking_date"] or timezone.now()

    if row["cn"] and order.tracking_number != row["cn"]:
        changes["tracking_number"] = row["cn"][:100]
    if row["tags"] and order.tag != row["tags"]:
        changes["tag"] = row["tags"][:100]
    if row["invoice_number"] and order.invoice_number != row["invoice_number"]:
        changes["invoice_number"] = row["invoice_number"][:100]
    if row["delivery_charges"] is not None and order.shipping_amount != row["delivery_charges"]:
        changes["shipping_amount"] = row["delivery_charges"]
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

    return changes


def _courier_lookup(organization_id, rows, create_missing):
    names = {row["courier"] for row in rows if row["courier"]}
    existing = {
        c.name.lower(): c
        for c in Courier.all_objects.filter(organization_id=organization_id)
    }
    if create_missing:
        for name in names:
            if name.lower() not in existing:
                existing[name.lower()] = Courier.all_objects.create(
                    organization_id=organization_id, name=name[:150], is_active=True
                )
    return existing


def run_import(organization_id, file_obj, *, dry_run=True, overwrite_final=False):
    """Parses the sheet and (unless dry_run) applies it.

    dry_run is the default on purpose: this rewrites status and money on
    live orders, and the caller should be able to see exactly what would
    change before committing to it.
    """
    rows, errors = parse_rows(file_obj)
    if not rows:
        return {
            "total_rows": 0,
            "matched": 0,
            "matched_by_phone": 0,
            "unmatched": 0,
            "to_update": 0,
            "unchanged": 0,
            "protected": 0,
            "errors": errors,
            "unmatched_samples": [],
            "unmatched_rows": [],
            "protected_samples": [],
            "samples": [],
            "applied": False,
        }

    matches, unresolved = _match_orders(organization_id, rows)
    unmatched = [row["display_number"] for row in unresolved]
    # Couriers are only created for a real run - a preview must not leave
    # rows behind in the database.
    courier_lookup = _courier_lookup(organization_id, rows, create_missing=not dry_run)

    planned, protected, unchanged = [], [], 0
    for row, order, matched_via in matches:
        if order.status in _PROTECTED and row["status"] and order.status != row["status"]:
            if not overwrite_final:
                protected.append(
                    {
                        "order_number": order.order_number,
                        "current": order.status,
                        "incoming": row["status"],
                    }
                )
                continue
        changes = _row_changes(row, order, courier_lookup)
        if changes:
            planned.append((order, changes, matched_via))
        else:
            unchanged += 1

    samples = [
        {
            "order_number": order.order_number,
            "matched_via": matched_via,
            "changes": {
                k: (v.isoformat() if hasattr(v, "isoformat") else str(v))
                for k, v in changes.items()
            },
        }
        for order, changes, matched_via in planned[:10]
    ]

    applied = False
    if not dry_run and planned:
        fields = set()
        for order, changes, _matched_via in planned:
            for key, value in changes.items():
                setattr(order, key, value)
                fields.add(key)
            order.updated_at = timezone.now()
        fields.add("updated_at")
        with transaction.atomic():
            # Chunked so one enormous sheet doesn't build a single
            # multi-thousand-row UPDATE statement.
            Order.all_objects.bulk_update(
                [order for order, _, _ in planned], sorted(fields), batch_size=500
            )
        applied = True

    matched_by_phone = sum(1 for _row, _order, matched_via in matches if matched_via == "phone")

    return {
        "total_rows": len(rows),
        "matched": len(matches),
        "matched_by_phone": matched_by_phone,
        "unmatched": len(unmatched),
        "to_update": len(planned),
        "unchanged": unchanged,
        "protected": len(protected),
        "errors": errors[:20],
        "unmatched_samples": unmatched[:20],
        "unmatched_rows": [_unmatched_row_export(row) for row in unresolved],
        "protected_samples": protected[:20],
        "samples": samples,
        "applied": applied,
    }
