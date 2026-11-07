"""Super admin's Inventory: every store's Inventory table in one list, each
row with its store's name - the same rows and numbers the store sees on its
own Inventory page (services.inventory_overview's rows). Searching a SKU
lists that SKU's row in every store that stocks it. Read only. Mounted
under /api/core/admin/inventory/ so AdminIPAllowlistMiddleware covers it,
same as the other admin views."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.models import Organization
from core.permissions import IsSuperAdmin

from . import services
from .models import StockItem


def _all_store_rows(search="", activity=""):
    """(rows, summary) across every store holding stock items - each row
    the store's own Inventory row plus store_id / store_name."""
    org_ids = StockItem.all_objects.values_list("organization_id", flat=True).distinct()
    names = dict(
        Organization.objects.filter(id__in=org_ids, is_platform=False).values_list("id", "name")
    )
    rows = []
    summary = {"total": 0, **{a: 0 for a in services.INVENTORY_ACTIVITY}}
    term = (search or "").strip().lower()
    for org_id, name in sorted(names.items(), key=lambda pair: pair[1].lower()):
        order_metrics = services._order_metrics(org_id)
        purchase_metrics = services._purchase_metrics(org_id)
        items = StockItem.all_objects.filter(organization_id=org_id).select_related("warehouse")
        for item in items:
            row = services._inventory_row(item, order_metrics, purchase_metrics)
            summary["total"] += 1
            if row["activity"]:
                summary[row["activity"]] += 1
            if term and term not in (row["sku"] or "").lower() and term not in (row["product_name"] or "").lower():
                continue
            if activity in services.INVENTORY_ACTIVITY and row["activity"] != activity:
                continue
            rows.append({**row, "store_id": str(org_id), "store_name": name})
    return rows, summary


# Per stock row (one warehouse's shelf): added up over every row.
_STOCK_FIELDS = ("available", "total_inbound", "po_damaged")
# Per store (from its orders - every warehouse row of one store carries the
# same figures): added up once per store, never once per warehouse.
_ORDER_FIELDS = (
    "delivered", "dispatched", "failed_delivery", "return_in_transit",
    "returns_damaged", "returns_lost", "ordered",
    "delivered_orders", "dispatched_orders", "failed_delivery_orders", "return_in_transit_orders",
)


def _group_key(row):
    """One SKU across stores - case and spaces ignored. A row with no SKU
    groups by its product name, never with a SKU."""
    sku = (row.get("sku") or "").strip().lower()
    if sku:
        return ("sku", sku)
    return ("name", (row.get("product_name") or "").strip().lower())


def _grouped_activity(rows):
    activities = {r["activity"] for r in rows}
    for activity in ("active", "inactive"):
        if activity in activities:
            return activity
    return "out_of_stock"


def _group_by_sku(rows):
    """Every store row of one SKU folded into one: stock summed per row,
    order figures once per store; `stores` keeps the store rows, most
    available first."""
    groups = {}
    for row in rows:
        groups.setdefault(_group_key(row), []).append(row)

    grouped = []
    for key, members in groups.items():
        names = {}
        for r in members:
            if r.get("product_name"):
                names[r["product_name"]] = names.get(r["product_name"], 0) + 1
        sku = next((r["sku"] for r in members if r.get("sku")), "")
        item = {
            "key": f"{key[0]}:{key[1]}",
            "sku": (sku or "").strip(),
            "product_name": max(names, key=names.get) if names else "",
            "image_url": next((r["image_url"] for r in members if r.get("image_url")), ""),
            "store_count": len({r["store_id"] for r in members}),
            **{f: sum(r.get(f) or 0 for r in members) for f in _STOCK_FIELDS},
        }
        per_store = {}
        for r in members:
            per_store.setdefault(r["store_id"], r)
        for f in _ORDER_FIELDS:
            item[f] = sum(r.get(f) or 0 for r in per_store.values())
        item["damaged_lost"] = item["returns_damaged"] + item["returns_lost"] + item["po_damaged"]
        item["activity"] = _grouped_activity(members)
        item["stores"] = sorted(members, key=lambda r: (-(r.get("available") or 0), r["store_name"].lower()))
        grouped.append(item)
    grouped.sort(key=lambda g: ((g["sku"] or g["product_name"]).lower()))
    return grouped


def _grouped_rows(search="", activity=""):
    """(groups, summary) - the SKU view: one row per SKU over every store.
    Cards count SKUs; search and the activity filter pick SKUs."""
    rows, _ = _all_store_rows()
    groups = _group_by_sku(rows)
    summary = {"total": len(groups), **{a: 0 for a in services.INVENTORY_ACTIVITY}}
    for g in groups:
        summary[g["activity"]] += 1
    term = (search or "").strip().lower()
    if term:
        groups = [
            g for g in groups
            if term in g["sku"].lower()
            or any(term in (r.get("product_name") or "").lower() or term in (r.get("sku") or "").lower()
                   for r in g["stores"])
        ]
    if activity in services.INVENTORY_ACTIVITY:
        groups = [g for g in groups if g["activity"] == activity]
    return groups, summary


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def inventory(request):
    """?group=sku - one row per SKU (its store rows under "stores");
    otherwise one row per store's stock item, as before."""
    params = request.query_params
    if params.get("group") == "sku":
        rows, summary = _grouped_rows(params.get("search") or "", params.get("activity") or "")
    else:
        rows, summary = _all_store_rows(params.get("search") or "", params.get("activity") or "")
    try:
        page_size = min(max(int(params.get("page_size") or 25), 1), 500)
        page = max(int(params.get("page") or 1), 1)
    except ValueError:
        page_size, page = 25, 1
    start = (page - 1) * page_size
    return Response({"count": len(rows), "results": rows[start : start + page_size], "summary": summary})


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def inventory_report(request, item_id):
    """One item's details (the eye icon), whichever store it belongs to."""
    item = StockItem.all_objects.select_related("warehouse").filter(id=item_id).first()
    if item is None:
        return Response({"detail": "Not found."}, status=404)
    return Response(services.inventory_item_report(item))
