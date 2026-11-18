"""Read-only live data API (user, 2026-11-18): the orders report - the same
columns and values as the Orders page's Export CSV > All
(oms/orders_report.py) - for every order of every active store, whether or
not it's in the Dispatch Hub (the super admin's All Orders tab:
core.dispatch_hub_service.all_store_organization_ids). Built fresh from the
live database on every call; nothing is stored.

    GET /api/oms/export/orders-report/
    Header: X-API-Key: <settings.EXPORT_API_KEY>

    ?format=json (default) | csv
    ?updated_since=2026-11-18T10:00:00Z   only orders changed since then
    ?cursor=<next_cursor>                 the next page (from the last reply)
    ?limit=500                            orders per page (max 2000)
    ?limit=all                            EVERY order in one reply, streamed -
                                          for curl / Excel, which can't page

Orders come oldest-change first (updated_at, then id). A script keeps
calling with `cursor` while has_more is true, then saves next_cursor and
starts from it next time - nothing missed, nothing sent twice. An order
with several products is several rows (one per product), as in the report.

Read only - GET, no writes anywhere. No Supabase login: the API key is the
only way in, compared in constant time; an empty EXPORT_API_KEY switches
the API off. Tokens, passwords and courier keys are never in the report.
"""

import csv
import hmac
import io
import logging

from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_GET

from core.dispatch_hub_service import all_store_organization_ids

from .models import Order
from .orders_report import all_orders_report

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 500
MAX_LIMIT = 2000


def _plain(value):
    """JSON cells: the value as text, with no Excel ="..." wrapping."""
    return "" if value is None else str(value)


def _key_ok(request):
    expected = getattr(settings, "EXPORT_API_KEY", "") or ""
    given = request.META.get("HTTP_X_API_KEY", "") or ""
    return bool(expected) and hmac.compare_digest(given.encode(), expected.encode())


def _parse_cursor(value):
    """"<updated_at ISO>|<order id>" -> (datetime, id), or None."""
    when, sep, order_id = (value or "").partition("|")
    parsed = parse_datetime(when) if sep else None
    return (parsed, order_id) if parsed and order_id else None


def _error(message, status):
    return JsonResponse({"detail": message}, status=status)


class _Echo:
    def write(self, value):
        return value


def _stream_all(ordered, fmt):
    """limit=all: every order of `ordered` in one streamed reply (built as
    it is sent, like Export CSV, so a big pull never sits in memory).
    next_cursor is worked out first - the newest change in the reply - so a
    script can carry on from it with ?cursor= next time."""
    import json

    last = ordered.values_list("id", "updated_at").last()
    next_cursor = f"{last[1].isoformat()}|{last[0]}" if last else ""
    logger.info("data API: all orders (%s)", fmt)

    if fmt == "csv":
        header, rows = all_orders_report(ordered, {})
        writer = csv.writer(_Echo())

        def lines():
            yield writer.writerow(header)
            for row in rows:
                yield writer.writerow(row)

        response = StreamingHttpResponse(lines(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="orders_report_all.csv"'
        response["X-Has-More"] = "false"
        response["X-Next-Cursor"] = next_cursor
        return response

    header, rows = all_orders_report(ordered, {}, text=_plain)

    def chunks():
        yield (
            '{"generated_at": ' + json.dumps(timezone.now().isoformat())
            + ', "has_more": false, "next_cursor": ' + json.dumps(next_cursor)
            + ', "columns": ' + json.dumps(header) + ', "rows": ['
        )
        first = True
        for row in rows:
            yield ("" if first else ",") + json.dumps(dict(zip(header, row)), default=str)
            first = False
        yield "]}"

    response = StreamingHttpResponse(chunks(), content_type="application/json")
    response["X-Has-More"] = "false"
    response["X-Next-Cursor"] = next_cursor
    return response


@require_GET
def orders_report(request):
    if not getattr(settings, "EXPORT_API_KEY", ""):
        return _error("The data API is switched off.", 503)
    if not _key_ok(request):
        return _error("Invalid or missing X-API-Key.", 401)

    params = request.GET
    fmt = (params.get("format") or "json").lower()
    if fmt not in ("json", "csv"):
        return _error("format must be json or csv.", 400)
    everything = (params.get("limit") or "").strip().lower() == "all"
    try:
        limit = DEFAULT_LIMIT if everything else min(max(int(params.get("limit") or DEFAULT_LIMIT), 1), MAX_LIMIT)
    except ValueError:
        return _error("limit must be a number, or all.", 400)

    qs = Order.all_objects.filter(organization_id__in=all_store_organization_ids())
    if params.get("updated_since"):
        since = parse_datetime(params["updated_since"])
        if since is None:
            return _error("updated_since must be an ISO date-time, e.g. 2026-11-18T10:00:00Z.", 400)
        qs = qs.filter(updated_at__gte=since)
    if params.get("cursor"):
        cursor = _parse_cursor(params["cursor"])
        if cursor is None:
            return _error("Invalid cursor - use next_cursor from the last reply.", 400)
        when, order_id = cursor
        qs = qs.filter(Q(updated_at__gt=when) | Q(updated_at=when, id__gt=order_id))

    if everything:
        return _stream_all(qs.order_by("updated_at", "id"), fmt)

    page = list(qs.order_by("updated_at", "id").values_list("id", "updated_at")[: limit + 1])
    has_more = len(page) > limit
    page = page[:limit]
    next_cursor = f"{page[-1][1].isoformat()}|{page[-1][0]}" if page else (params.get("cursor") or "")

    page_qs = Order.all_objects.filter(id__in=[order_id for order_id, _ in page]).order_by("updated_at", "id")
    if fmt == "csv":
        header, rows = all_orders_report(page_qs, {})
    else:
        header, rows = all_orders_report(page_qs, {}, text=_plain)
    rows = list(rows)
    logger.info("data API: %s orders, %s rows (%s), has_more=%s", len(page), len(rows), fmt, has_more)

    if fmt == "csv":
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(header)
        writer.writerows(rows)
        response = HttpResponse(out.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="orders_report.csv"'
        response["X-Orders"] = str(len(page))
        response["X-Has-More"] = "true" if has_more else "false"
        response["X-Next-Cursor"] = next_cursor
        return response

    return JsonResponse({
        "generated_at": timezone.now().isoformat(),
        "orders": len(page),
        "rows_count": len(rows),
        "has_more": has_more,
        "next_cursor": next_cursor,
        "columns": header,
        "rows": [dict(zip(header, row)) for row in rows],
    })
