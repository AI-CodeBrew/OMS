"""Returns desk - Export (order list) and Import (SKU-wise counts).

Export: every returned order the desk shows (its card, dates, search) - one
row per order, with what was counted when it was received.

Import: the desk's count popup for many parcels at once - one row per
order line (SKU, or product name for a line without SKU) with its Good /
Damaged / Lost units. Each order goes through exactly what a scan does
(wms.views._receive_return -> services.build_return_breakdown +
restock_from_return): it must be Returned and not yet received, every
line's good + damaged + lost must equal its quantity, and only good units
go back into stock. An order already received is never received twice.
"""

import csv
import io
import re

from django.db import transaction

from oms.models import Order

from . import services

# ---------------------------------------------------------------- helpers


def _plain(value):
    """A cell as written - our own CSVs wrap IDs as ="12345" for Excel."""
    text = (value or "").strip()
    match = re.fullmatch(r'="(.*)"', text)
    return (match.group(1) if match else text).strip()


def _as_text(value):
    value = "" if value is None else str(value)
    return f'="{value}"' if value else ""


def _int(value):
    text = _plain(value).replace(",", "")
    if not text:
        return 0
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number == int(number) else None


def _breakdown_totals(order):
    totals = {"good": 0, "damaged": 0, "lost": 0}
    for line in order.return_breakdown or []:
        for key in totals:
            totals[key] += int(line.get(key) or 0)
    return totals


def returned_orders(org_kwargs, params, received=None):
    """The desk's orders: Returned, with the page's filters (search, dates).
    received: None (all), True, False."""
    from oms.views import OrderViewSet

    qs = Order.objects.filter(status="returned", **org_kwargs)
    filters = {k: v for k, v in params.items() if k in ("search", "search_field", "date_from", "date_to")}
    qs = OrderViewSet()._apply_filters(qs, filters)
    if received is True:
        qs = qs.filter(return_received_at__isnull=False)
    elif received is False:
        qs = qs.filter(return_received_at__isnull=True)
    return qs.select_related("courier", "organization").prefetch_related("items")


# ---------------------------------------------------------------- export

EXPORT_HEADERS = [
    "Store Order ID", "OMS Order ID", "Store", "CN", "Courier", "Customer Name", "Phone", "City",
    "Returned At", "Received", "Received At", "Received By", "Condition",
    "Good", "Damaged", "Lost", "Return Reason",
]


def export_rows(qs, when):
    yield EXPORT_HEADERS
    for order in qs.order_by("-returned_at", "-created_at").iterator(chunk_size=500):
        totals = _breakdown_totals(order)
        received = bool(order.return_received_at)
        condition = ""
        if received:
            parts = [k.capitalize() for k in ("good", "damaged", "lost") if totals[k]]
            condition = " / ".join(parts) or ("Good" if order.return_condition == "good" else "Damaged")
        yield [
            _as_text(order.original_order_number or order.order_number),
            _as_text(order.supabase_order_no or ""),
            order.shop,
            _as_text(order.tracking_number),
            order.courier.name if order.courier_id else "",
            order.customer_name,
            _as_text(order.customer_phone),
            order.city,
            when(order.returned_at),
            "Yes" if received else "No",
            when(order.return_received_at),
            order.return_received_by_email or "",
            condition,
            totals["good"] if received else "",
            totals["damaged"] if received else "",
            totals["lost"] if received else "",
            order.return_reason or "",
        ]


# ---------------------------------------------------------------- import

IMPORT_HEADERS = ["Store Order ID", "CN", "SKU", "Product", "Qty", "Good", "Damaged", "Lost"]

_ALIASES = {
    "store order id": "order_number", "web order id": "order_number", "web orderid": "order_number",
    "order no": "order_number", "order number": "order_number", "order id": "order_number",
    "cn": "cn", "tracking number": "cn", "tracking": "cn", "consignment no": "cn", "consignment": "cn",
    "sku": "sku", "sku code": "sku", "product": "product", "product name": "product",
    "qty": "qty", "quantity": "qty",
    "good": "good", "damaged": "damaged", "lost": "lost", "lost/missing": "lost", "missing": "lost",
}


def import_sheet_rows(qs):
    """One row per line of every order still Awaiting Scan, Good prefilled
    with the full quantity - edit Damaged / Lost where needed."""
    yield IMPORT_HEADERS
    for order in qs.order_by("-returned_at", "-created_at").iterator(chunk_size=500):
        for line in services.return_line_summary(order):
            yield [
                _as_text(order.original_order_number or order.order_number),
                _as_text(order.tracking_number),
                line["sku"],
                line["product_name"],
                line["quantity"],
                line["quantity"],
                0,
                0,
            ]


def _parse(file_obj):
    raw = file_obj.read()
    text = raw.decode("utf-8-sig", errors="replace") if isinstance(raw, bytes) else raw
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None) or []
    columns = {}
    for index, name in enumerate(header):
        key = _ALIASES.get((name or "").strip().lower())
        if key and key not in columns:
            columns[key] = index
    errors = []
    if "order_number" not in columns and "cn" not in columns:
        return [], ["No order column found - expected 'Store Order ID' and/or 'CN'."]
    if "good" not in columns:
        return [], ["No 'Good' column found - expected Good, Damaged, Lost."]
    rows = []
    for line_no, cells in enumerate(reader, start=2):
        if not any((c or "").strip() for c in cells):
            continue
        cell = lambda key: _plain(cells[columns[key]]) if key in columns and columns[key] < len(cells) else ""
        counts = {k: _int(cell(k)) for k in ("good", "damaged", "lost")}
        if any(v is None for v in counts.values()):
            errors.append(f"Line {line_no}: Good / Damaged / Lost must be whole numbers")
            continue
        rows.append({
            "line": line_no,
            "order_number": cell("order_number"),
            "cn": cell("cn"),
            "sku": cell("sku"),
            "product": cell("product"),
            **counts,
        })
    return rows, errors


def _find(org_kwargs, cn, number, cache):
    """(order, problem) - by CN first (unique across stores), else the store
    order number (with or without #)."""
    key = (cn, number)
    if key in cache:
        return cache[key]
    order, problem = None, ""
    if cn:
        hits = list(Order.objects.filter(tracking_number=cn, **org_kwargs)[:2])
        if len(hits) == 1:
            order = hits[0]
        elif len(hits) > 1:
            problem = "CN is on more than one order"
    if order is None and not problem and number:
        variants = {number, number.lstrip("#"), "#" + number.lstrip("#")}
        hits = list(Order.objects.filter(order_number__in=variants, **org_kwargs)[:2])
        hits = hits or list(Order.objects.filter(original_order_number__in=variants, **org_kwargs)[:2])
        if len(hits) == 1:
            order = hits[0]
        elif len(hits) > 1:
            problem = "Order number is in more than one store - add the CN"
    if order is None and not problem:
        problem = "Not found"
    cache[key] = (order, problem)
    return order, problem


def plan_import(org_kwargs, file_obj):
    """[{order, order_number, counts, problem, good, damaged, lost}], errors."""
    rows, errors = _parse(file_obj)
    groups = {}
    for row in rows:
        key = row["cn"] or row["order_number"]
        if not key:
            errors.append(f"Line {row['line']}: no Store Order ID or CN")
            continue
        groups.setdefault(key, []).append(row)

    cache, planned = {}, []
    for key, group in groups.items():
        first = group[0]
        order, problem = _find(org_kwargs, first["cn"], first["order_number"], cache)
        entry = {
            "order": order,
            "order_number": order.order_number if order else (first["order_number"] or first["cn"]),
            "cn": first["cn"] or (order.tracking_number if order else ""),
            "good": sum(r["good"] for r in group),
            "damaged": sum(r["damaged"] for r in group),
            "lost": sum(r["lost"] for r in group),
            "counts": None,
            "problem": problem,
        }
        if order is not None and not problem:
            if order.status != "returned":
                entry["problem"] = f"Order is {order.get_status_display()}, not Returned"
            elif order.return_received_at:
                entry["problem"] = "Already received"
            else:
                lines = services.return_line_summary(order)
                by_sku = {l["sku"].lower(): l for l in lines if l["sku"]}
                by_name = {l["product_name"].strip().lower(): l for l in lines}
                counts = {}
                # An order with no products: received with nothing to count,
                # same as the desk's scan.
                for r in (group if lines else []):
                    line = by_sku.get(r["sku"].lower()) if r["sku"] else None
                    line = line or by_name.get(r["product"].strip().lower())
                    # One-product order: SKU / Product may be left blank.
                    if line is None and not r["sku"] and not r["product"] and len(lines) == 1:
                        line = lines[0]
                    if line is None:
                        entry["problem"] = (
                            f"Product not on this order: {r['sku'] or r['product']}"
                            if (r["sku"] or r["product"])
                            else f"Line {r['line']}: fill in the SKU or Product - this order has {len(lines)} products"
                        )
                        break
                    c = counts.setdefault(line["key"], {"good": 0, "damaged": 0, "lost": 0})
                    for k in ("good", "damaged", "lost"):
                        c[k] += r[k]
                if not entry["problem"]:
                    try:
                        services.build_return_breakdown(order, counts)
                        entry["counts"] = counts
                    except services.InvalidReturnBreakdown as exc:
                        entry["problem"] = str(exc)
        planned.append(entry)
    return planned, errors


def run_import(org_kwargs, file_obj, *, apply, actor_user_id, actor_email):
    from .views import _receive_return

    planned, errors = plan_import(org_kwargs, file_obj)
    received = 0
    results = []
    for entry in planned:
        status = "error" if entry["problem"] else ("ready" if not apply else "")
        reason = entry["problem"]
        restocked = 0
        if apply and not entry["problem"]:
            with transaction.atomic():
                outcome = _receive_return(
                    entry["order"], entry["order_number"], counts=entry["counts"],
                    actor_user_id=actor_user_id, actor_email=actor_email, note="Returns import",
                )
            if outcome.get("success"):
                status = "received"
                received += 1
                restocked = sum(m["quantity"] for m in outcome.get("restocked", []))
            else:
                status, reason = "error", outcome.get("reason") or "Not received"
        results.append({
            "order_number": entry["order_number"],
            "cn": entry["cn"],
            "good": entry["good"],
            "damaged": entry["damaged"],
            "lost": entry["lost"],
            "status": status,
            "reason": reason,
            "restocked": restocked,
        })
    ok = [r for r in results if r["status"] in ("ready", "received")]
    return {
        "orders": len(results),
        "ready": len(ok),
        "problems": len(results) - len(ok),
        "received": received,
        "good": sum(r["good"] for r in ok),
        "damaged": sum(r["damaged"] for r in ok),
        "lost": sum(r["lost"] for r in ok),
        "results": results,
        "errors": errors[:100],
        "applied": bool(apply),
    }
