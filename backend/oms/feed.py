"""Read-only JSON feed of orders for Google Sheets / Apps Script.

    GET /api/oms/feed/orders/
    Header  X-Feed-Key: <ORDERS_FEED_KEY>    (or ?key=..., for a quick browser check)

Apps Script (and IMPORTDATA) can't log in through Supabase, so this sits
outside the normal JWT auth and is locked by its own shared secret instead,
read from the ORDERS_FEED_KEY env var / Fly secret. With no key configured
the endpoint doesn't exist (404). Anyone holding the key can read every
store's orders, customer details included - rotate it by setting a new
secret.

Query params (all optional):
    updated_since  ISO datetime - only orders changed at/after it, for
                   incremental syncs (pass the last row's updated_at back)
    store          organization name(s), comma-separated
    status         status code(s), comma-separated, e.g. delivered,returned
    date_from/to   YYYY-MM-DD on the order date (Pakistan time)
    page, page_size  page_size up to 1000 (default 500); follow `next`
"""
import hmac
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import Prefetch, Q
from django.http import Http404, JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.views.decorators.http import require_GET

from .models import Order, OrderItem

PKT = ZoneInfo("Asia/Karachi")
MAX_PAGE_SIZE = 1000


def _when(value):
    return value.astimezone(PKT).isoformat(timespec="seconds") if value else None


def _money(value):
    return float(value) if value is not None else None


def _order_json(order):
    return {
        "id": str(order.id),
        "oms_order_id": order.supabase_order_no,
        "order_number": order.order_number,
        "store_name": order.organization.name,
        "status": order.status,
        "status_label": order.get_status_display(),
        "fulfillment_status": order.fulfillment_status,
        "payment_status": order.payment_status,
        "payment_gateway": order.payment_gateway,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "customer_email": order.customer_email,
        "address_line1": order.address_line1,
        "address_line2": order.address_line2,
        "city": order.city,
        "courier": order.courier.name if order.courier_id else "",
        "courier_status": order.courier_status,
        "tracking_number": order.tracking_number,
        "tag": order.tag,
        "issue_note": order.issue_note,
        "return_reason": order.return_reason,
        "total_amount": _money(order.total_amount),
        "shipping_amount": _money(order.shipping_amount),
        "grand_total": _money(order.grand_total),
        "amount_paid": _money(order.amount_paid),
        "amount_receivable": _money(order.amount_receivable),
        "courier_charges": _money(order.courier_charges),
        "order_date": _when(order.placed_at or order.created_at),
        "dispatched_at": _when(order.dispatched_at),
        "delivered_at": _when(order.delivered_at),
        "returned_at": _when(order.returned_at),
        "created_at": _when(order.created_at),
        "updated_at": _when(order.updated_at),
        "items": [
            {
                "product_name": item.product_name,
                "sku": item.barcode,
                "quantity": item.quantity,
                "unit_price": _money(item.unit_price),
            }
            for item in order.items.all()
        ],
    }


def _split(value):
    return [v.strip() for v in (value or "").split(",") if v.strip()]


@require_GET
def orders_feed(request):
    expected = getattr(settings, "ORDERS_FEED_KEY", "") or ""
    if not expected:
        raise Http404
    given = request.headers.get("X-Feed-Key") or request.GET.get("key") or ""
    if not hmac.compare_digest(given.encode(), expected.encode()):
        return JsonResponse({"detail": "Invalid or missing feed key"}, status=401)

    params = request.GET
    qs = Order.all_objects.select_related("organization", "courier").prefetch_related(
        Prefetch("items", queryset=OrderItem.all_objects.order_by("id"))
    )

    if params.get("updated_since"):
        since = parse_datetime(params["updated_since"])
        if since is None:
            return JsonResponse({"detail": "updated_since must be an ISO datetime"}, status=400)
        if timezone.is_naive(since):
            since = since.replace(tzinfo=PKT)
        qs = qs.filter(updated_at__gte=since)
    if params.get("store"):
        qs = qs.filter(organization__name__in=_split(params["store"]))
    if params.get("status"):
        qs = qs.filter(status__in=_split(params["status"]))
    for name, bound, lookup in (("date_from", time.min, "gte"), ("date_to", time.max, "lte")):
        if params.get(name):
            day = parse_date(params[name])
            if day is None:
                return JsonResponse({"detail": f"{name} must be YYYY-MM-DD"}, status=400)
            moment = datetime.combine(day, bound, tzinfo=PKT)
            qs = qs.filter(
                Q(placed_at__isnull=False, **{f"placed_at__{lookup}": moment})
                | Q(placed_at__isnull=True, **{f"created_at__{lookup}": moment})
            )

    # Oldest change first, so an incremental sync can resume from the last
    # row's updated_at without missing anything.
    qs = qs.order_by("updated_at", "id")

    try:
        page = max(int(params.get("page") or 1), 1)
        page_size = min(max(int(params.get("page_size") or 500), 1), MAX_PAGE_SIZE)
    except ValueError:
        return JsonResponse({"detail": "page and page_size must be whole numbers"}, status=400)

    count = qs.count()
    start = (page - 1) * page_size
    results = [_order_json(order) for order in qs[start : start + page_size]]

    next_url = None
    if start + page_size < count:
        query = params.copy()
        query.pop("key", None)  # never echo the secret back into a URL
        query["page"] = page + 1
        next_url = request.build_absolute_uri(f"{request.path}?{query.urlencode()}")

    return JsonResponse(
        {
            "count": count,
            "page": page,
            "page_size": page_size,
            "next": next_url,
            "generated_at": _when(timezone.now()),
            "results": results,
        },
        json_dumps_params={"ensure_ascii": False},
    )
