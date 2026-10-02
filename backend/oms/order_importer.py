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
    "order no": "order_number",
    "order number": "order_number",
    "order date": "order_date",
    "customer name": "customer_name",
    "phone": "phone",
    "address": "address",
    "city": "city",
    "product": "product_name",
    "sku": "sku",
    "qty": "quantity",
    "quantity": "quantity",
    "unit price": "unit_price",
    "shipping": "shipping",
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
    "lineitem name": "product_name",
    "lineitem sku": "sku",
    "lineitem quantity": "quantity",
    "lineitem price": "unit_price",
    "notes attribute": "notes",
}

TEMPLATE_HEADERS = [
    "Order No",
    "Order Date",
    "Customer Name",
    "Phone",
    "Address",
    "City",
    "Product",
    "SKU",
    "Qty",
    "Unit Price",
    "Shipping",
    "COD Amount",
    "Notes",
]

TEMPLATE_SAMPLE_ROW = [
    "1001",
    "2026-10-01",
    "Jane Doe",
    "03001234567",
    "House 12, Street 4, DHA",
    "Lahore",
    "Black T-Shirt",
    "TS-BLK-M",
    "2",
    "1500",
    "200",
    "3200",
    "Call before delivery",
]


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


def template_csv():
    """The downloadable blank template (header + one example row)."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(TEMPLATE_HEADERS)
    writer.writerow(TEMPLATE_SAMPLE_ROW)
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
        order_number = _clean(row.get("order_number"))
        if not order_number:
            errors.append(f"Line {line_number}: missing order number")
            continue
        product_name = _clean(row.get("product_name"))
        if not product_name:
            errors.append(f"Line {line_number}: missing product name")
            continue
        rows.append(
            {
                "line": line_number,
                "order_number": order_number,
                "order_date": _clean(row.get("order_date")),
                "customer_name": _clean(row.get("customer_name")) or "Unknown",
                "phone": _clean(row.get("phone")),
                "address": _clean(row.get("address")),
                "city": _clean(row.get("city")),
                "product_name": product_name,
                "sku": _clean(row.get("sku")),
                "quantity": _parse_int(row.get("quantity")),
                "unit_price": _parse_decimal(row.get("unit_price"), default=Decimal("0")),
                "shipping": _parse_decimal(row.get("shipping"), default=Decimal("0")),
                "cod_amount": _parse_decimal(row.get("cod_amount")),
                "notes": _clean(row.get("notes")),
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
                "address": row["address"],
                "city": row["city"],
                "shipping": row["shipping"],
                "cod_amount": row["cod_amount"],
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
            address_line1=group["address"][:255],
            city=group["city"][:100],
            status="new",
            shop=(shop_label or "Manual")[:150],
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
