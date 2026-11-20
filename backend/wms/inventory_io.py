"""Inventory page - Export and Import (user, 2026-11-18).

Export: the Inventory table as a CSV (services.inventory_overview's rows,
with the page's search / card filter).

Import: a CSV of SKU / Product Name / Warehouse / Available (the Export
file works as it is - other columns are ignored). Each row sets that item's
stock to Available:
- found by SKU (any case), else by its exact product name when only one
  item in the warehouse has it;
- a change goes through services.adjust_stock, exactly like the Adjust
  popup - a stock history line, and for a Shopify-linked item the change
  waits for Push to Shopify;
- a row that matches nothing becomes a new item.
A dry run unless apply; nothing is applied while any row has a problem.
"""

import csv
import io

from django.db import transaction
from django.db.models import F

from . import services
from .models import StockItem, Warehouse

EXPORT_HEADER = [
    "SKU", "Product Name", "Warehouse", "Available", "Reorder Level", "Order Placed", "Total Inbound",
    "Reserved for Dispatch", "Delivered", "Dispatched", "Failed Delivery", "Return in Transit", "Damaged/Lost",
]
MAX_ROWS = 5000
PREVIEW_ROWS = 1000

# Header names accepted for each column (lower-case, spaces / _ ignored).
COLUMNS = {
    "sku": ("sku",),
    "name": ("productname", "name", "product"),
    "warehouse": ("warehouse",),
    "available": ("available", "quantity", "qty", "stock", "onhand"),
    "reorder": ("reorderlevel", "reorder"),
}


def export_rows(organization_id, *, search="", activity="", sku_filter=""):
    rows, _summary = services.inventory_overview(
        organization_id, search=search, activity=activity, sku_filter=sku_filter
    )
    yield EXPORT_HEADER
    for r in rows:
        yield [
            r["sku"], r["product_name"], r["warehouse_name"], r["available"], r["reorder_level"],
            r.get("order_placed", 0), r.get("total_inbound", 0), r.get("reserved", 0), r.get("delivered", 0),
            r.get("dispatched", 0),
            r.get("failed_delivery", 0), r.get("return_in_transit", 0), r.get("damaged_lost", 0),
        ]


def _key(text):
    return "".join(ch for ch in (text or "").lower() if ch.isalnum())


def _clean(value):
    # Excel's ="0123" text wrapping, and stray spaces.
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
    rows = []
    for line_no, cells in enumerate(reader, start=2):
        if not any((c or "").strip() for c in cells):
            continue
        get = lambda col: _clean(cells[where[col]]) if col in where and where[col] < len(cells) else ""
        rows.append({"line": line_no, **{col: get(col) for col in COLUMNS}})
    return where, rows


def _whole(text):
    text = (text or "").replace(",", "").strip()
    if text.endswith(".0"):
        text = text[:-2]
    return int(text)


def run_import(organization_id, upload, *, apply=False, actor_user_id=None):
    where, rows = _read(upload)
    if "available" not in where or ("sku" not in where and "name" not in where):
        return {"error": "The file needs an Available column, and SKU and/or Product Name."}
    if len(rows) > MAX_ROWS:
        return {"error": f"At most {MAX_ROWS} rows per file."}

    stock_org = services.stock_org_id(organization_id)
    warehouses = list(Warehouse.all_objects.filter(organization_id=stock_org, is_active=True))
    by_name = {w.name.strip().lower(): w for w in warehouses}
    default = services.get_default_warehouse(organization_id)
    # Several rows can share a SKU (Shopify variants): a SKU row sets the one
    # booking takes from - Shopify-linked first, then the oldest (services._sku_items).
    items = list(StockItem.all_objects.filter(organization_id=stock_org).order_by(
        F("shopify_inventory_item_id").asc(nulls_last=True), "created_at"
    ))
    by_sku, by_title = {}, {}
    for item in items:
        if item.sku:
            by_sku.setdefault((item.warehouse_id, item.sku.strip().lower()), item)
        if item.product_name:
            by_title.setdefault((item.warehouse_id, item.product_name.strip().lower()), []).append(item)

    results, seen = [], {}
    for row in rows:
        result = {"line": row["line"], "sku": row["sku"], "product_name": row["name"],
                  "warehouse": "", "current": None, "new": None, "delta": 0, "status": "", "reason": ""}
        results.append(result)
        problem = lambda reason: result.update(status="error", reason=reason)

        if row["warehouse"]:
            warehouse = by_name.get(row["warehouse"].lower())
            if warehouse is None:
                problem(f"No warehouse named {row['warehouse']}")
                continue
        else:
            warehouse = default
            if warehouse is None:
                problem("No warehouse set up")
                continue
        result["warehouse"] = warehouse.name
        if not row["sku"] and not row["name"]:
            problem("No SKU or product name")
            continue
        try:
            new = _whole(row["available"])
        except ValueError:
            problem(f"Available must be a whole number (got {row['available'] or 'blank'})")
            continue
        reorder = None
        if row["reorder"]:
            try:
                reorder = _whole(row["reorder"])
                if reorder < 0:
                    raise ValueError
            except ValueError:
                problem("Reorder Level must be a whole number, 0 or more")
                continue
        result["new"] = new

        # Blank Warehouse: the item wherever it is (one match), else a new
        # item in the default warehouse.
        places = [warehouse.id] if row["warehouse"] else [w.id for w in warehouses]
        found = [by_sku[(p, row["sku"].lower())] for p in places if (p, row["sku"].lower()) in by_sku] if row["sku"] else []
        if not found and row["name"]:
            # By name only for a row with no SKU, or an item that has none.
            found = [i for p in places for i in by_title.get((p, row["name"].lower()), []) if not row["sku"] or not i.sku]
        if len(found) > 1:
            problem("Matches items in more than one warehouse or with the same name - fill in Warehouse / SKU")
            continue
        item = found[0] if found else None
        if item is not None:
            warehouse = next(w for w in warehouses if w.id == item.warehouse_id)
            result["warehouse"] = warehouse.name

        key = str(item.id) if item else (warehouse.id, row["sku"].lower(), row["name"].lower())
        if key in seen:
            problem(f"Same item as line {seen[key]}")
            continue
        seen[key] = row["line"]

        if item is None:
            result.update(status="create", delta=new, current=0)
        else:
            result.update(current=item.quantity, delta=new - item.quantity, sku=item.sku or row["sku"],
                          product_name=item.product_name or row["name"])
            reorder_changes = reorder is not None and reorder != item.reorder_level
            result["status"] = "update" if (new != item.quantity or reorder_changes) else "unchanged"
        result["_item"], result["_warehouse"], result["_reorder"] = item, warehouse, reorder

    counts = {s: sum(1 for r in results if r["status"] == s) for s in ("update", "create", "unchanged", "error")}
    applied = False
    if apply and not counts["error"]:
        note = f"Import: {(getattr(upload, 'name', '') or 'file')[:200]}"
        with transaction.atomic():
            for r in results:
                item, warehouse, reorder = r["_item"], r["_warehouse"], r["_reorder"]
                if r["status"] == "create":
                    item = StockItem.all_objects.create(
                        organization_id=stock_org, warehouse=warehouse, sku=r["sku"],
                        product_name=r["product_name"], quantity=0, reorder_level=reorder or 0,
                    )
                elif r["status"] != "update":
                    continue
                elif reorder is not None and reorder != item.reorder_level:
                    item.reorder_level = reorder
                    item.save(update_fields=["reorder_level", "updated_at"])
                if r["delta"]:
                    services.adjust_stock(
                        organization_id=organization_id, stock_item=item, delta=r["delta"],
                        actor_user_id=actor_user_id, note=note,
                    )
        applied = True

    for r in results:
        for k in ("_item", "_warehouse", "_reorder"):
            r.pop(k, None)
    return {
        "rows": len(results),
        **counts,
        "applied": applied,
        "results": results[:PREVIEW_ROWS],
        "truncated": len(results) > PREVIEW_ROWS,
    }
