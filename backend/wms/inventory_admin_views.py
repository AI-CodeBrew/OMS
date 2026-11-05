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


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def inventory(request):
    params = request.query_params
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
