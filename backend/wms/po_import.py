"""Purchase Orders - Import (user, 2026-11-19): create many POs from one CSV,
and add stock through them.

One row per product. Rows with the same PO Ref are one PO; its details
(supplier, warehouse, date, logistics cost, note) are read from its first
row, and later rows may leave them blank (or must repeat the same value).

    PO Ref            any text grouping rows into one PO (not saved)
    Supplier          supplier's name - a new supplier is added if none has it
    Supplier Phone    } only used when the supplier is new
    Supplier City     }
    Warehouse         the receiving warehouse's name - blank = default warehouse
    Order Date        dd/mm/yyyy - blank = now
    Logistics Cost    freight for the whole PO
    Note
    SKU               required
    Product Name      blank = the inventory item's name for that SKU
    Quantity Ordered  required, more than 0
    Unit Price        product cost per unit
    Good Received     already arrived in good condition - goes into stock now
    Damaged Received  already arrived damaged - counted, not stocked

Every PO goes through services.create_purchase_order, exactly like Create
PO: good units are added to stock with a history line (and queued for
Push to Shopify). A dry run unless apply; nothing is created while any
row has a problem, and the POs are created all together or not at all.
"""

import csv
import datetime
import io
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from . import services
from .models import StockItem, Supplier, Warehouse


class PoImportError(Exception):
    """A PO the checks passed but creating it failed - nothing was saved."""

# Dates are Pakistan days (the server's clock is UTC).
PKT = ZoneInfo("Asia/Karachi")

TEMPLATE_HEADER = [
    "PO Ref", "Supplier", "Supplier Phone", "Supplier City", "Warehouse", "Order Date", "Logistics Cost",
    "Note", "SKU", "Product Name", "Quantity Ordered", "Unit Price", "Good Received", "Damaged Received",
]
TEMPLATE_ROWS = [
    ["PO-A", "Ali Traders", "03001234567", "Lahore", "", "19/11/2026", "1500", "China shipment",
     "JTW57-FYNK", "MOSQUITO KILLER LAMP", "100", "850", "100", "0"],
    ["PO-A", "Ali Traders", "", "", "", "", "", "",
     "C8V56-FYNK", "PRO PEELER CUTTER", "200", "120", "195", "5"],
    ["PO-B", "Karachi Wholesale", "", "Karachi", "", "", "", "Not arrived yet",
     "Y3EE7-FYNK", "Happy Animal Toothbrush", "300", "90", "0", "0"],
]
MAX_ROWS = 2000

# Accepted header spellings (lower-case, letters and digits only).
COLUMNS = {
    "ref": ("poref", "po", "ponumber", "poreference", "reference", "ref"),
    "supplier": ("supplier", "suppliername", "vendor"),
    "supplier_phone": ("supplierphone", "phone"),
    "supplier_city": ("suppliercity", "city"),
    "warehouse": ("warehouse", "receivingwarehouse"),
    "date": ("orderdate", "date", "orderedat"),
    "logistics": ("logisticscost", "logistics", "freight", "shipping"),
    "note": ("note", "notes", "remarks"),
    "sku": ("sku",),
    "name": ("productname", "product", "name"),
    "qty": ("quantityordered", "quantity", "qty"),
    "price": ("unitprice", "price", "cost", "unitcost"),
    "good": ("goodreceived", "good"),
    "damaged": ("damagedreceived", "damaged"),
}
PO_FIELDS = ("supplier", "supplier_phone", "supplier_city", "warehouse", "date", "logistics", "note")


def template_rows():
    yield TEMPLATE_HEADER
    yield from TEMPLATE_ROWS


def _key(text):
    return "".join(ch for ch in (text or "").lower() if ch.isalnum())


def _clean(value):
    value = (value or "").strip()
    if value.startswith('="') and value.endswith('"'):
        value = value[2:-1]
    return value.strip()


def _read(upload):
    raw = upload.read()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None) or []
    where = {}
    for index, name in enumerate(header):
        for column, aliases in COLUMNS.items():
            if _key(name) in aliases and column not in where:
                where[column] = index
                break
    rows = []
    for line_no, cells in enumerate(reader, start=2):
        if not any((c or "").strip() for c in cells):
            continue
        get = lambda col: _clean(cells[where[col]]) if col in where and where[col] < len(cells) else ""
        rows.append({"line": line_no, **{col: get(col) for col in COLUMNS}})
    return where, rows


def _whole(text, label):
    text = (text or "").replace(",", "").strip()
    if not text:
        return 0
    if text.endswith(".0"):
        text = text[:-2]
    try:
        value = int(text)
    except ValueError:
        raise ValueError(f"{label} must be a whole number (got {text!r})")
    if value < 0:
        raise ValueError(f"{label} can't be negative")
    return value


def _money(text, label):
    text = (text or "").replace(",", "").strip()
    if not text:
        return Decimal("0")
    try:
        value = Decimal(text)
    except InvalidOperation:
        raise ValueError(f"{label} must be a number (got {text!r})")
    if value < 0:
        raise ValueError(f"{label} can't be negative")
    return value.quantize(Decimal("0.01"))


def _date(text):
    """dd/mm/yyyy (also dd-mm-yyyy or yyyy-mm-dd), a Pakistan day -> an
    aware datetime; today is the current time, another day its noon."""
    text = (text or "").strip()
    if not text:
        return timezone.now()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d.%m.%Y"):
        try:
            day = datetime.datetime.strptime(text, fmt).date()
            break
        except ValueError:
            continue
    else:
        raise ValueError(f"Order Date must be dd/mm/yyyy (got {text!r})")
    today = timezone.localdate(timezone=PKT)
    if day == today:
        return timezone.now()
    if day > today:
        raise ValueError("Order Date can't be in the future")
    return datetime.datetime.combine(day, datetime.time(12, 0), tzinfo=PKT)


def run_import(organization_id, upload, *, apply=False, actor_user_id=None):
    where, rows = _read(upload)
    missing = [label for col, label in (("ref", "PO Ref"), ("supplier", "Supplier"), ("sku", "SKU"),
                                         ("qty", "Quantity Ordered")) if col not in where]
    if missing:
        return {"error": "The file is missing column(s): " + ", ".join(missing)
                + ". Download the template for the right columns."}
    if not rows:
        return {"error": "The file has no rows."}
    if len(rows) > MAX_ROWS:
        return {"error": f"At most {MAX_ROWS} rows per file."}

    stock_org = services.stock_org_id(organization_id)
    warehouses = list(Warehouse.all_objects.filter(organization_id=stock_org, is_active=True))
    default_warehouse = services.get_default_warehouse(organization_id)
    suppliers = {}
    for supplier in Supplier.all_objects.filter(organization_id=stock_org).order_by("created_at"):
        suppliers.setdefault(supplier.name.strip().lower(), supplier)
    items = {}
    for item in StockItem.all_objects.filter(organization_id=stock_org).exclude(sku="").order_by(
        F("shopify_inventory_item_id").asc(nulls_last=True), "created_at"
    ):
        items.setdefault(item.sku.strip().lower(), item)

    def find_warehouse(name):
        if not name:
            return default_warehouse, None
        exact = [w for w in warehouses if w.name.strip() == name]
        loose = [w for w in warehouses if w.name.strip().lower() == name.lower()]
        hits = exact or loose
        if len(hits) == 1:
            return hits[0], None
        if not hits:
            return None, f"No warehouse named {name!r}"
        return None, f"More than one warehouse is named {name!r} - write it exactly as on the Warehouses list"

    # Group rows into POs, in file order.
    groups = {}
    for row in rows:
        groups.setdefault(row["ref"] or f"(line {row['line']})", []).append(row)

    pos = []
    for ref, group in groups.items():
        po = {"ref": ref, "problems": [], "lines": []}
        pos.append(po)
        if not group[0]["ref"]:
            po["problems"].append(f"Line {group[0]['line']}: PO Ref is blank")
        # PO-level details: the first filled value; a different one later is a problem.
        details = {}
        for field in PO_FIELDS:
            values = [(r["line"], r[field]) for r in group if r[field]]
            details[field] = values[0][1] if values else ""
            for line_no, value in values[1:]:
                if value.strip().lower() != details[field].strip().lower():
                    po["problems"].append(f"Line {line_no}: {field.replace('_', ' ').title()} {value!r} "
                                          f"differs from {details[field]!r} on the same PO")
        name = details["supplier"]
        po["supplier"] = name
        po["supplier_new"] = bool(name) and name.strip().lower() not in suppliers
        if not name:
            po["problems"].append("Supplier is blank")
        warehouse, problem = find_warehouse(details["warehouse"])
        if problem:
            po["problems"].append(problem)
        elif warehouse is None:
            po["problems"].append("No warehouse set up - add one on the Purchase Orders page first")
        po["warehouse"] = warehouse.name if warehouse else details["warehouse"]
        po["_warehouse"] = warehouse
        po["supplier_phone"], po["supplier_city"], po["note"] = (
            details["supplier_phone"][:50], details["supplier_city"][:100], details["note"][:255]
        )
        try:
            po["_ordered_at"] = _date(details["date"])
            po["ordered_at"] = po["_ordered_at"].astimezone(PKT).strftime("%d/%m/%Y")
        except ValueError as exc:
            po["problems"].append(str(exc))
            po["_ordered_at"], po["ordered_at"] = None, details["date"]
        try:
            po["logistics_cost"] = _money(details["logistics"], "Logistics Cost")
        except ValueError as exc:
            po["problems"].append(str(exc))
            po["logistics_cost"] = Decimal("0")

        seen = {}
        for row in group:
            line = {"line": row["line"], "sku": row["sku"], "product_name": row["name"], "problems": [],
                    "new_item": False}
            po["lines"].append(line)
            if not row["sku"]:
                line["problems"].append("SKU is blank")
            elif row["sku"].lower() in seen:
                line["problems"].append(f"Same SKU as line {seen[row['sku'].lower()]} - put it on one line")
            else:
                seen[row["sku"].lower()] = row["line"]
            item = items.get(row["sku"].lower()) if row["sku"] else None
            line["new_item"] = bool(row["sku"]) and item is None
            if item and not line["product_name"]:
                line["product_name"] = item.product_name
            line["image_url"] = item.image_url if item else ""
            try:
                line["quantity_ordered"] = _whole(row["qty"], "Quantity Ordered")
                if line["quantity_ordered"] <= 0:
                    raise ValueError("Quantity Ordered must be more than 0")
                line["good"] = _whole(row["good"], "Good Received")
                line["damaged"] = _whole(row["damaged"], "Damaged Received")
                if line["good"] + line["damaged"] > line["quantity_ordered"]:
                    raise ValueError("Good + Damaged is more than Quantity Ordered")
                line["unit_price"] = _money(row["price"], "Unit Price")
            except ValueError as exc:
                line["problems"].append(str(exc))
                for key in ("quantity_ordered", "good", "damaged"):
                    line.setdefault(key, 0)
                line.setdefault("unit_price", Decimal("0"))
        po["units_ordered"] = sum(l["quantity_ordered"] for l in po["lines"])
        po["units_good"] = sum(l["good"] for l in po["lines"])
        po["products_cost"] = sum(l["quantity_ordered"] * l["unit_price"] for l in po["lines"])
        po["total_cost"] = po["products_cost"] + po["logistics_cost"]

    problem_count = sum(len(p["problems"]) + sum(len(l["problems"]) for l in p["lines"]) for p in pos)
    created = []
    if apply and not problem_count:
        with transaction.atomic():
            for po in pos:
                key = po["supplier"].strip().lower()
                supplier = suppliers.get(key)
                if supplier is None:
                    supplier = Supplier.all_objects.create(
                        organization_id=stock_org, name=po["supplier"].strip()[:150],
                        phone=po["supplier_phone"], city=po["supplier_city"],
                    )
                    suppliers[key] = supplier
                try:
                    created_po = services.create_purchase_order(
                        organization_id=organization_id,
                        supplier=supplier,
                        warehouse=po["_warehouse"],
                        ordered_at=po["_ordered_at"],
                        note=po["note"] or f"Imported ({po['ref']})",
                        logistics_cost=po["logistics_cost"],
                        lines=[{
                            "sku": l["sku"], "product_name": l["product_name"], "image_url": l["image_url"],
                            "quantity_ordered": l["quantity_ordered"], "unit_price": l["unit_price"],
                            "good": l["good"], "damaged": l["damaged"],
                        } for l in po["lines"]],
                        actor_user_id=actor_user_id,
                    )
                except services.PurchaseOrderError as exc:
                    # Rolls every PO of this import back.
                    raise PoImportError(f"{po['ref']}: {exc} - nothing was saved.") from exc
                po["po_number"] = created_po.po_number
                created.append(created_po.po_number)

    for po in pos:
        po.pop("_warehouse", None)
        po.pop("_ordered_at", None)
        for key in ("logistics_cost", "products_cost", "total_cost"):
            po[key] = str(po[key])
        for line in po["lines"]:
            line["unit_price"] = str(line["unit_price"])
    return {
        "pos": pos,
        "po_count": len(pos),
        "rows": len(rows),
        "new_suppliers": sorted({p["supplier"] for p in pos if p["supplier_new"]}),
        "units_ordered": sum(p["units_ordered"] for p in pos),
        "units_good": sum(p["units_good"] for p in pos),
        "problems": problem_count,
        "applied": bool(created),
        "created": created,
    }
