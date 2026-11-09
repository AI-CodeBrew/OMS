"""CSV import that CREATES orders - for stores with no Shopify connection
("manual stores", see core.models.Organization.is_manual_store) whose only
way into OMS is a spreadsheet.

Deliberately separate from importers.py, which only ever updates orders
that already exist (a courier/settlement sheet keyed by an order number we
already have). This one is the other direction: the order number here is
new, so matching rows are grouped into brand-new Order + OrderItem rows
instead of updated in place.
"""

import csv
import io
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from .models import Order, OrderItem, OrderNote

_BLANK = {"", "--", "-", "n/a", "na", "null", "none"}

# Our own template's headers, plus the Shopify "Export orders" column names
# so a store can drop that export straight in without relabeling it first.
COLUMN_ALIASES = {
    # our template
    # The Dispatch Hub's import only: which store (oms.Store.store_id) the
    # order goes to - see preview_import_multi / apply_import_multi.
    "store id": "store_id",
    "order no": "order_number",
    "order number": "order_number",
    "order date": "order_date",
    "customer name": "customer_name",
    "phone": "phone",
    "secondary phone": "secondary_phone",
    "email": "email",
    "address": "address",
    "city": "city",
    "payment method": "payment_method",
    "product": "product_name",
    "sku": "sku",
    "qty": "quantity",
    "quantity": "quantity",
    "unit price": "unit_price",
    "weight (grams)": "weight_grams",
    "weight": "weight_grams",
    "shipping": "shipping",
    "shipping charges": "shipping",
    # Older template column - still read so old sheets don't break, but
    # never used: the amount is worked out from the items + shipping.
    "cod amount": "cod_amount",
    "notes": "notes",
    # Shopify "Export orders" CSV
    "name": "order_number",
    "created at": "order_date",
    "shipping name": "customer_name",
    "shipping phone": "phone",
    "phone number": "phone",
    "shipping address1": "address",
    "shipping city": "city",
    "financial status": "payment_method",
    "lineitem name": "product_name",
    "lineitem sku": "sku",
    "lineitem quantity": "quantity",
    "lineitem price": "unit_price",
    "notes attribute": "notes",
}

# Every field a normal OMS order carries - the same ones the Manual Order
# form asks for. Columns marked required in REQUIRED_COLUMNS must be filled
# on every row; the rest may be left blank.
TEMPLATE_HEADERS = [
    "Order No",
    "Order Date",
    "Customer Name",
    "Phone",
    "Email",
    "Address",
    "City",
    "Payment Method",
    "Product",
    "SKU",
    "Qty",
    "Unit Price",
    "Weight (grams)",
    "Shipping Charges",
    "Notes",
]

# Two rows with one Order No = one order with two items.
TEMPLATE_SAMPLE_ROWS = [
    [
        "1001", "2026-10-01", "Ali Khan", "03001234567", "ali@example.com",
        "House 12, Street 4, DHA Phase 5", "Lahore", "COD", "Black T-Shirt", "TS-BLK-M",
        "2", "1500", "250", "200", "Call before delivery",
    ],
    [
        "1001", "2026-10-01", "Ali Khan", "03001234567", "ali@example.com",
        "House 12, Street 4, DHA Phase 5", "Lahore", "COD", "Blue Jeans", "JN-BLU-32",
        "1", "2500", "600", "200", "",
    ],
]

# (row key, column label) - checked on every row.
REQUIRED_COLUMNS = [
    ("order_number", "Order No"),
    ("customer_name", "Customer Name"),
    ("phone", "Phone"),
    ("address", "Address"),
    ("city", "City"),
    ("product_name", "Product"),
    ("quantity", "Qty"),
    ("unit_price", "Unit Price"),
]


def payment_gateway_for(value):
    """'COD' / 'Prepaid' (or Shopify's financial status) -> Order.payment_gateway.
    Blank or unrecognised counts as COD, the common case."""
    value = (value or "").strip().lower()
    if value in ("prepaid", "paid", "cc", "card", "online", "bank transfer"):
        return "cc"
    return "cod"


def _clean(value):
    value = (value or "").strip()
    return "" if value.lower() in _BLANK else value


def _parse_decimal(value, default=None):
    raw = _clean(value).replace(",", "")
    if not raw:
        return default
    try:
        return Decimal(raw)
    except InvalidOperation:
        return default


def _parse_int(value, default=1):
    raw = _clean(value)
    if not raw:
        return default
    try:
        return max(int(Decimal(raw)), 1)
    except (InvalidOperation, ValueError):
        return default


def template_csv(with_store_id=False):
    """The downloadable blank template (header + example rows). The
    Dispatch Hub's version starts with a Store ID column - one file can
    hold several stores' orders."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    if with_store_id:
        writer.writerow(["Store ID", *TEMPLATE_HEADERS])
        writer.writerows(["1", *row] for row in TEMPLATE_SAMPLE_ROWS)
    else:
        writer.writerow(TEMPLATE_HEADERS)
        writer.writerows(TEMPLATE_SAMPLE_ROWS)
    return buffer.getvalue()


def parse_rows(file_obj):
    """Reads the uploaded CSV into normalised row dicts, one per line.
    Returns (rows, errors)."""
    raw = file_obj.read()
    text = raw.decode("utf-8-sig", errors="replace") if isinstance(raw, bytes) else raw

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
            "No order-number column found. Expected 'Order No' - download the template "
            "below to see the exact columns."
        ]

    rows, errors = [], []
    for line_number, raw_row in enumerate(reader, start=2):
        row = {key: raw_row.get(name) for name, key in header_map.items()}
        missing = [label for key, label in REQUIRED_COLUMNS if not _clean(row.get(key))]
        if missing:
            errors.append(f"Line {line_number}: missing {', '.join(missing)}")
            continue
        unit_price = _parse_decimal(row.get("unit_price"))
        if unit_price is None or unit_price < 0:
            errors.append(f"Line {line_number}: Unit Price must be a number")
            continue
        rows.append(
            {
                "line": line_number,
                "order_number": _clean(row.get("order_number")),
                "order_date": _clean(row.get("order_date")),
                "customer_name": _clean(row.get("customer_name")),
                "phone": _clean(row.get("phone")),
                "secondary_phone": _clean(row.get("secondary_phone")),
                "email": _clean(row.get("email")),
                "address": _clean(row.get("address")),
                "city": _clean(row.get("city")),
                "payment_gateway": payment_gateway_for(_clean(row.get("payment_method"))),
                "product_name": _clean(row.get("product_name")),
                "sku": _clean(row.get("sku")),
                "quantity": _parse_int(row.get("quantity")),
                "unit_price": unit_price,
                "weight_grams": _parse_int(row.get("weight_grams"), default=None),
                "shipping": _parse_decimal(row.get("shipping"), default=Decimal("0")),
                "notes": _clean(row.get("notes")),
                "store_id": _clean(row.get("store_id")),
            }
        )
    return rows, errors


def _group_by_order(rows):
    """Several line-item rows sharing one Order No become one order with
    several items - first row's customer/shipping fields win, same as a
    real order form where every line shares one delivery address."""
    groups = {}
    for row in rows:
        group = groups.setdefault(
            row["order_number"],
            {
                "order_number": row["order_number"],
                "order_date": row["order_date"],
                "customer_name": row["customer_name"],
                "phone": row["phone"],
                "secondary_phone": row["secondary_phone"],
                "email": row["email"],
                "address": row["address"],
                "city": row["city"],
                "payment_gateway": row["payment_gateway"],
                "shipping": row["shipping"],
                "notes": [],
                "items": [],
            },
        )
        if row["notes"] and row["notes"] not in group["notes"]:
            group["notes"].append(row["notes"])
        group["items"].append(row)
    return groups


def _parse_order_date(value):
    if not value:
        return None
    parsed = timezone.datetime.fromisoformat(value) if "T" in value else None
    if parsed is None:
        for fmt in ("%Y-%m-%d", "%d %b %Y", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                parsed = timezone.datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


def preview_import(organization_id, file_obj):
    """Dry run: parses the file and reports what WOULD be created, without
    writing anything."""
    rows, errors = parse_rows(file_obj)
    groups = _group_by_order(rows)
    wanted = list(groups.keys())
    existing = set(
        Order.all_objects.filter(
            organization_id=organization_id, order_number__in=wanted
        ).values_list("order_number", flat=True)
    )

    to_create = [n for n in wanted if n not in existing]
    skipped = [n for n in wanted if n in existing]
    return {
        "total_rows": len(rows),
        "orders_found": len(groups),
        "to_create": len(to_create),
        "skipped_existing": skipped[:50],
        "skipped_existing_count": len(skipped),
        "errors": errors,
        "samples": [
            {
                "order_number": n,
                "customer_name": groups[n]["customer_name"],
                "items": len(groups[n]["items"]),
            }
            for n in to_create[:10]
        ],
        "applied": False,
    }


@transaction.atomic
def apply_import(organization_id, file_obj, *, shop_label=""):
    """Same parse as preview_import, but actually creates the orders - one
    per unseen Order No, skipping any number that already exists so a
    re-upload of the same sheet is a safe no-op for rows already imported."""
    rows, errors = parse_rows(file_obj)
    groups = _group_by_order(rows)
    wanted = list(groups.keys())
    existing = set(
        Order.all_objects.filter(
            organization_id=organization_id, order_number__in=wanted
        ).values_list("order_number", flat=True)
    )

    created = []
    for order_number, group in groups.items():
        if order_number in existing:
            continue
        order = Order.all_objects.create(
            organization_id=organization_id,
            order_number=order_number[:50],
            customer_name=group["customer_name"][:255],
            customer_phone=group["phone"][:50],
            secondary_phone=group["secondary_phone"][:50],
            customer_email=group["email"][:255],
            address_line1=group["address"][:255],
            city=group["city"][:100],
            payment_gateway=group["payment_gateway"],
            status="new",
            shop=(shop_label or "Store")[:150],
            order_source="CSV",
            shipping_amount=group["shipping"] or Decimal("0"),
            placed_at=_parse_order_date(group["order_date"]),
        )
        total = Decimal("0")
        for item in group["items"]:
            OrderItem.all_objects.create(
                organization_id=organization_id,
                order=order,
                product_name=item["product_name"][:255],
                barcode=item["sku"][:100],
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                weight_grams=item["weight_grams"],
            )
            total += item["quantity"] * item["unit_price"]
        order.total_amount = total
        order.save(update_fields=["total_amount"])

        if group["notes"]:
            OrderNote.all_objects.create(
                organization_id=organization_id,
                order=order,
                kind="note",
                body="Imported: " + " | ".join(group["notes"]),
            )
        created.append(order_number)

    skipped = [n for n in wanted if n not in created and n in existing]
    return {
        "total_rows": len(rows),
        "orders_found": len(groups),
        "created": len(created),
        "created_order_numbers": created[:50],
        "skipped_existing": skipped[:50],
        "skipped_existing_count": len(skipped),
        "errors": errors,
        "applied": True,
    }


# --- Dispatch Hub / All Orders: one file, several stores --------------------
#
# Same columns as the store import plus "Store ID" (oms.Store.store_id - the
# Stores tab / report's Store ID). Each row's order goes to that store's
# organization, under that store's name. Rows sharing a Store ID and an
# Order No are one order. An Order No that already exists in that
# organization is skipped, so uploading the same file again creates nothing
# new. Big files: orders and items are inserted in batches.

_BATCH = 500


def _plan_multi(organization_ids, file_obj):
    """(rows, errors, groups, stores, existing): groups keyed by
    (store_id, order_number); stores {store_id: {"organization_id",
    "store_name", "organization_name"}}; existing {(org id, order no)}."""
    from core.models import Organization

    from .models import Store

    rows, errors = parse_rows(file_obj)
    wanted_ids = set()
    for row in rows:
        if row["store_id"].isdigit():
            wanted_ids.add(int(row["store_id"]))
    stores = {}
    org_names = {}
    for store in Store.all_objects.filter(
        store_id__in=wanted_ids, organization_id__in=list(organization_ids)
    ):
        stores[store.store_id] = {"organization_id": str(store.organization_id), "store_name": store.name}
    if stores:
        org_names = dict(
            Organization.objects.filter(id__in={s["organization_id"] for s in stores.values()})
            .values_list("id", "name")
        )
    for info in stores.values():
        info["organization_name"] = next(
            (name for oid, name in org_names.items() if str(oid) == info["organization_id"]), ""
        )

    groups = {}
    for row in rows:
        raw = row["store_id"]
        if not raw:
            errors.append(f"Line {row['line']}: missing Store ID")
            continue
        if not raw.isdigit() or int(raw) not in stores:
            errors.append(f"Line {row['line']}: Store ID {raw} not found")
            continue
        store_id = int(raw)
        group = groups.setdefault(
            (store_id, row["order_number"]),
            {
                "order_number": row["order_number"],
                "order_date": row["order_date"],
                "customer_name": row["customer_name"],
                "phone": row["phone"],
                "secondary_phone": row["secondary_phone"],
                "email": row["email"],
                "address": row["address"],
                "city": row["city"],
                "payment_gateway": row["payment_gateway"],
                "shipping": row["shipping"],
                "notes": [],
                "items": [],
            },
        )
        if row["notes"] and row["notes"] not in group["notes"]:
            group["notes"].append(row["notes"])
        group["items"].append(row)

    existing = set()
    by_org = {}
    for store_id, number in groups:
        by_org.setdefault(stores[store_id]["organization_id"], set()).add(number[:50])
    for org_id, numbers in by_org.items():
        numbers = list(numbers)
        for start in range(0, len(numbers), 2000):
            for number in Order.all_objects.filter(
                organization_id=org_id, order_number__in=numbers[start:start + 2000]
            ).values_list("order_number", flat=True):
                existing.add((org_id, number))
    return rows, errors, groups, stores, existing


def _store_summary(groups, stores, existing):
    summary = {}
    for (store_id, number), _group in groups.items():
        info = stores[store_id]
        entry = summary.setdefault(store_id, {
            "store_id": store_id,
            "store_name": info["store_name"],
            "organization_name": info["organization_name"],
            "to_create": 0,
            "existing": 0,
        })
        if (info["organization_id"], number[:50]) in existing:
            entry["existing"] += 1
        else:
            entry["to_create"] += 1
    return sorted(summary.values(), key=lambda s: s["store_id"])


def preview_import_multi(organization_ids, file_obj):
    """Dry run of apply_import_multi - per store, what would be created."""
    rows, errors, groups, stores, existing = _plan_multi(organization_ids, file_obj)
    per_store = _store_summary(groups, stores, existing)
    return {
        "total_rows": len(rows),
        "orders_found": len(groups),
        "to_create": sum(s["to_create"] for s in per_store),
        "skipped_existing_count": sum(s["existing"] for s in per_store),
        "stores": per_store,
        "errors": errors[:200],
        "error_count": len(errors),
        "applied": False,
    }


@transaction.atomic
def apply_import_multi(organization_ids, file_obj):
    """Creates every order of the file in its Store ID's store - all or
    nothing. Orders whose Order No already exists in that organization are
    skipped."""
    from decimal import Decimal as D

    rows, errors, groups, stores, existing = _plan_multi(organization_ids, file_obj)
    per_store = _store_summary(groups, stores, existing)
    new_orders, new_items, new_notes = [], [], []
    for (store_id, number), group in groups.items():
        info = stores[store_id]
        org_id = info["organization_id"]
        if (org_id, number[:50]) in existing:
            continue
        existing.add((org_id, number[:50]))  # one file can't create it twice
        total = sum((item["quantity"] * item["unit_price"] for item in group["items"]), D("0"))
        order = Order(
            organization_id=org_id,
            order_number=number[:50],
            customer_name=group["customer_name"][:255],
            customer_phone=group["phone"][:50],
            secondary_phone=group["secondary_phone"][:50],
            customer_email=group["email"][:255],
            address_line1=group["address"][:255],
            city=group["city"][:100],
            payment_gateway=group["payment_gateway"],
            status="new",
            shop=info["store_name"][:150],
            order_source="CSV",
            shipping_amount=group["shipping"] or D("0"),
            placed_at=_parse_order_date(group["order_date"]),
            total_amount=total,
        )
        new_orders.append(order)
        for item in group["items"]:
            new_items.append(OrderItem(
                organization_id=org_id,
                order=order,
                product_name=item["product_name"][:255],
                barcode=item["sku"][:100],
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                weight_grams=item["weight_grams"],
            ))
        if group["notes"]:
            new_notes.append(OrderNote(
                organization_id=org_id, order=order, kind="note",
                body="Imported: " + " | ".join(group["notes"]),
            ))
    Order.all_objects.bulk_create(new_orders, batch_size=_BATCH)
    OrderItem.all_objects.bulk_create(new_items, batch_size=_BATCH)
    OrderNote.all_objects.bulk_create(new_notes, batch_size=_BATCH)
    return {
        "total_rows": len(rows),
        "orders_found": len(groups),
        "created": len(new_orders),
        "skipped_existing_count": sum(s["existing"] for s in per_store),
        "stores": per_store,
        "errors": errors[:200],
        "error_count": len(errors),
        "applied": True,
    }
