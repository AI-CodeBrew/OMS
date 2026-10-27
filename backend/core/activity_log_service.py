"""Activity logs across every store - the super admin's Logs tab.

Two kinds of rows land in core.OrganizationAuditLog:

- explicit ones, written by a service through rbac.write_audit_log when it
  does something worth a sentence of its own ("Order 1042: confirmed →
  dispatched", "Connected Shopify");
- generic ones, written by TenantMiddleware for any create/edit/delete
  request no service logged itself, labelled from its URL name below
  (describe_request). Between the two, nothing a store user or FynkTech
  changes goes unrecorded.

Both carry who did it (role included), the IP and device it came from,
and a category for filtering.
"""

import json
import re
from datetime import datetime, time

from django.db.models import Q
from django.urls import Resolver404, resolve
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from .models import OrganizationAuditLog

CATEGORIES = ["orders", "wms", "integrations", "team", "finance", "support", "store", "other"]

# First match wins - action prefixes, then request paths.
_ACTION_CATEGORIES = [
    (("order.", "oms.", "order_"), "orders"),
    (("wms.", "stock", "return", "packing"), "wms"),
    (("integrations.", "oms_courier.", "shopify", "postex", "barqraftar", "smartlane"), "integrations"),
    (("team.",), "team"),
    (("invoice",), "finance"),
    (("ticket",), "support"),
    (("store_", "organization.", "dispatch_hub", "super_admin_action"), "store"),
]
_PATH_CATEGORIES = [
    (("/api/oms/tickets/", "/api/core/admin/tickets/"), "support"),
    (("/api/oms/",), "orders"),
    (("/api/wms/",), "wms"),
    (("/api/integrations/", "/api/core/admin/smartlane/", "/api/core/admin/oms-courier/"), "integrations"),
    (("/api/core/team/",), "team"),
    (("/api/finance/", "/api/core/admin/invoices/"), "finance"),
    (
        (
            "/api/core/stores/",
            "/api/core/admin/organizations/",
            "/api/core/admin/users/",
            "/api/core/admin/dispatch-hub/",
        ),
        "store",
    ),
]


def category_for(action, path=""):
    action = action or ""
    if action.startswith("request."):
        action = ""  # a generic row - its path says more than its URL name
    for prefixes, category in _ACTION_CATEGORIES:
        if action.startswith(prefixes):
            return category
    for prefixes, category in _PATH_CATEGORIES:
        if (path or "").startswith(prefixes):
            return category
    return "other"


# --- Generic request rows ----------------------------------------------------

# Requests that change nothing anyone would want to audit.
SKIP_PATHS = (
    "/api/core/notifications/read/",
    "/api/core/health/",
    "/api/oms/orders/warmup/",
)

# url name -> {method: label}; "*" covers every mutating method. Anything
# missing falls back to a humanised url name (see _fallback_label).
ROUTE_LABELS = {
    "order-list": {"POST": "Created an order"},
    "order-detail": {"PATCH": "Edited order", "PUT": "Edited order", "DELETE": "Deleted order"},
    "order-bulk-action": {"*": "Bulk action on orders"},
    "order-dispatch-hub-membership": {"*": "Changed Dispatch Hub orders"},
    "order-scan-dispatch": {"*": "Scanned parcel for dispatch"},
    "order-scan-return": {"*": "Scanned a return"},
    "order-export": {"*": "Exported orders"},
    "order-import-csv": {"*": "Imported a courier/finance sheet"},
    "order-import-orders": {"*": "Imported orders from CSV"},
    "order-smartlane-airway-bill": {"*": "Printed Smartlane airway bills"},
    "order-smartlane-load-sheet": {"*": "Printed Smartlane load sheet"},
    "order-airway-bill": {"*": "Printed airway bill for order"},
    "order-loadsheet": {"*": "Printed load sheet for order"},
    "order-notes": {"POST": "Added a note to order", "*": "Changed notes on order"},
    "order-split": {"*": "Split order"},
    "order-transactions": {"POST": "Recorded a payment on order", "*": "Changed payments on order"},
    "courier-list": {"POST": "Added a courier"},
    "courier-detail": {"DELETE": "Removed a courier", "*": "Edited a courier"},
    "print-batch-list": {"POST": "Created a print batch"},
    "print-batch-detail": {"DELETE": "Deleted a print batch", "*": "Edited a print batch"},
    "ticket-list": {"POST": "Opened a support ticket"},
    "ticket-detail": {"*": "Updated a support ticket"},
    "ticket-messages": {"POST": "Replied on a support ticket"},
    "warehouse-list": {"POST": "Added a warehouse"},
    "warehouse-detail": {"DELETE": "Removed a warehouse", "*": "Edited a warehouse"},
    "stock-item-list": {"POST": "Added a stock item"},
    "stock-item-detail": {"DELETE": "Deleted a stock item", "*": "Edited a stock item"},
    "stock-item-adjust": {"*": "Adjusted stock"},
    "stock-item-import-skus": {"*": "Imported SKUs"},
    "stock-item-push-shopify": {"*": "Pushed stock to Shopify"},
    "stock-item-sync-shopify": {"*": "Synced stock from Shopify"},
    "stock-item-create-on-shopify": {"*": "Created products on Shopify"},
    "return-restock-scan": {"*": "Received a return at the warehouse"},
    "return-restock-bulk-receive": {"*": "Bulk-received returns"},
    "packing-scan": {"*": "Packed a parcel"},
    "packing-bulk-pack": {"*": "Bulk-packed parcels"},
    "shopify-sync": {"*": "Synced orders from Shopify"},
    "shopify-push-statuses": {"*": "Pushed statuses to Shopify"},
    "shopify-test-connection": {"*": "Tested the Shopify connection"},
    "postex-sync": {"*": "Synced PostEx statuses"},
    "postex-shipments": {"*": "Booked PostEx shipments"},
    "postex-shipment-action": {"*": "PostEx shipment action"},
    "postex-airway-bills": {"*": "Printed PostEx airway bills"},
    "postex-loadsheet": {"*": "Generated PostEx load sheet"},
    "barqraftar-sync": {"*": "Synced BarqRaftar statuses"},
    "barqraftar-shipments": {"*": "Booked BarqRaftar shipments"},
    "barqraftar-shipment-action": {"*": "BarqRaftar shipment action"},
    "barqraftar-labels": {"*": "Printed BarqRaftar labels"},
    "barqraftar-loadsheet": {"*": "Generated BarqRaftar load sheet"},
    "smartlane-sync": {"*": "Synced Smartlane statuses"},
    "oms-courier-onboarding": {"*": "Updated OMS Courier onboarding"},
    "oms-courier-requests": {"*": "Requested a courier through OMS Courier"},
    "oms-courier-courier-sync": {"*": "Synced OMS Courier statuses"},
    "bank-details": {"*": "Updated bank details"},
    "team-members": {"POST": "Invited a team member"},
    "team-member-detail": {"DELETE": "Removed a team member", "*": "Changed a team member"},
    "stores": {"POST": "Created a store"},
    "stores-switch": {"*": "Switched store"},
    "admin-organizations": {"POST": "Created an organization"},
    "admin-organization-detail": {"DELETE": "Deleted organization", "*": "Changed organization"},
    "admin-update-member": {"*": "Changed a store user's access"},
    "admin-dispatch-hub-stores": {"POST": "Added a store to the Dispatch Hub"},
    "admin-dispatch-hub-store-detail": {
        "DELETE": "Removed a store from the Dispatch Hub",
        "*": "Changed a Dispatch Hub store",
    },
    "admin-ticket-resolve": {"*": "Resolved a support ticket"},
    "admin-ticket-status": {"*": "Changed a ticket's status"},
    "admin-cities": {"POST": "Added cities to the city list"},
    "admin-cities-import": {"*": "Imported the couriers' cities"},
    "admin-city-detail": {"DELETE": "Removed a city from the city list"},
    "admin-ticket-messages": {"POST": "Replied on a support ticket"},
    "admin-invoice-generate": {"*": "Generated invoices"},
}

_METHOD_VERBS = {"POST": "", "PUT": "Updated", "PATCH": "Updated", "DELETE": "Deleted"}

# Values never stored from a request body - matched against the key, case-insensitively.
_SECRET_KEY = re.compile(r"pass|secret|token|api[_-]?key|apikey|authorization|credential|private", re.I)
_MAX_BODY_CHARS = 3000
MAX_CAPTURE_BYTES = 64 * 1024


def _fallback_label(url_name, method):
    words = (url_name or "request").replace("admin-", "").replace("-", " ").replace("_", " ")
    verb = _METHOD_VERBS.get(method, "")
    return f"{verb} {words}".strip().capitalize()


def _label(url_name, method):
    labels = ROUTE_LABELS.get(url_name)
    if labels:
        return labels.get(method) or labels.get("*") or _fallback_label(url_name, method)
    return _fallback_label(url_name, method)


def _redact(value, depth=0):
    if depth > 4:
        return "…"
    if isinstance(value, dict):
        return {
            k: ("••••" if _SECRET_KEY.search(str(k)) else _redact(v, depth + 1))
            for k, v in list(value.items())[:60]
        }
    if isinstance(value, list):
        if len(value) > 25:
            return [_redact(v, depth + 1) for v in value[:25]] + [f"… {len(value) - 25} more"]
        return [_redact(v, depth + 1) for v in value]
    if isinstance(value, str) and len(value) > 300:
        return value[:300] + "…"
    return value


def capture_body(request):
    """Reads a JSON body before the view does (reading request.body caches
    it, so DRF can still parse it afterwards). Anything else - file
    uploads, form posts - is only described, never stored."""
    content_type = (request.META.get("CONTENT_TYPE") or "").lower()
    try:
        length = int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if "multipart/form-data" in content_type:
        return {"_upload": True}
    if "application/json" not in content_type or not length or length > MAX_CAPTURE_BYTES:
        return None
    try:
        return json.loads(request.body or b"null")
    except (ValueError, UnicodeDecodeError):
        return None
    except Exception:  # noqa: BLE001 - RawPostDataException etc.: just skip it
        return None


def sanitize_body(body):
    if body is None:
        return None
    safe = _redact(body)
    text = json.dumps(safe, default=str)
    if len(text) > _MAX_BODY_CHARS:
        if isinstance(safe, dict):
            return {"_truncated": True, "keys": list(safe.keys())[:60]}
        return {"_truncated": True}
    return safe


def _count_hint(body):
    """'(12 orders)' for a bulk request - any list under a key ending in ids."""
    if not isinstance(body, dict):
        return ""
    for key, value in body.items():
        if str(key).lower().endswith("ids") and isinstance(value, list) and value:
            noun = "orders" if "order" in str(key).lower() or key == "ids" else "items"
            return f" ({len(value)} {noun})"
    return ""


def _order_number(order_id):
    try:
        from django.apps import apps

        Order = apps.get_model("oms", "Order")
        return Order.all_objects.filter(id=order_id).values_list("order_number", flat=True).first()
    except Exception:  # noqa: BLE001 - a label is never worth failing the log over
        return None


def describe_request(request, body):
    """(action, summary, entity_type, entity_id) for a request no service
    logged itself."""
    try:
        match = resolve(request.path)
        url_name, kwargs = match.url_name or "", match.kwargs
    except Resolver404:
        url_name, kwargs = "", {}

    summary = _label(url_name, request.method)
    entity_type, entity_id = "", ""
    pk = kwargs.get("pk")
    if pk and url_name.startswith("order-"):
        entity_type, entity_id = "order", str(pk)
        number = _order_number(pk)
        summary = f"{summary} {number}" if number else summary
    elif pk:
        entity_type, entity_id = url_name.rsplit("-", 1)[0], str(pk)
    else:
        for key in ("organization_id", "ticket_id", "invoice_id", "request_id", "user_id", "link_id"):
            if kwargs.get(key):
                entity_type, entity_id = key[:-3], str(kwargs[key])
                break

    if isinstance(body, dict):
        if url_name == "order-bulk-action" and body.get("action"):
            summary = f"Bulk {str(body['action']).replace('_', ' ')} on orders"
        elif url_name == "order-detail" and body.get("status"):
            summary = f"{summary} - status set to {body['status']}"
        elif request.method in ("PATCH", "PUT") and entity_id:
            # "Edited order #1042: phone, address line1" - what changed.
            fields = [
                str(k).replace("_", " ")
                for k in body
                if not str(k).endswith("id") and not _SECRET_KEY.search(str(k))
            ]
            if fields:
                summary = f"{summary}: {', '.join(fields[:6])}{' …' if len(fields) > 6 else ''}"
        elif url_name == "admin-organization-detail" and body.get("confirm_name"):
            # The org (and its own log) is gone by now - keep its name here.
            summary = f"{summary} {body['confirm_name']}"
    summary += _count_hint(body)
    return f"request.{url_name or 'unknown'}"[:64], summary, entity_type, entity_id


# --- Super admin queries ---------------------------------------------------------


def _bound(raw, *, end=False):
    if not raw:
        return None
    dt = parse_datetime(str(raw))
    if dt is None:
        d = parse_date(str(raw))
        if d is None:
            return None
        dt = datetime.combine(d, time.max if end else time.min)
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt


def _filtered(params):
    qs = OrganizationAuditLog.all_objects.all()
    store = params.get("organization") or ""
    if store == "platform":
        qs = qs.filter(organization__isnull=True)
    elif store:
        qs = qs.filter(organization_id=store)

    actor = params.get("actor") or ""
    if actor == "store":
        qs = qs.filter(
            actor_role__in=[OrganizationAuditLog.ROLE_STORE_ADMIN, OrganizationAuditLog.ROLE_STORE_USER]
        )
    elif actor:
        qs = qs.filter(actor_role=actor)

    category = params.get("category") or ""
    if category:
        qs = qs.filter(category=category)

    # One record's whole history - e.g. every log of one order.
    if params.get("entity_id"):
        qs = qs.filter(entity_id=params["entity_id"])
        if params.get("entity_type"):
            qs = qs.filter(entity_type=params["entity_type"])

    outcome = params.get("outcome") or ""
    if outcome == "failed":
        qs = qs.filter(status_code__gte=400)
    elif outcome == "ok":
        qs = qs.filter(Q(status_code__isnull=True) | Q(status_code__lt=400))

    dt_from = _bound(params.get("from"))
    if dt_from:
        qs = qs.filter(created_at__gte=dt_from)
    dt_to = _bound(params.get("to"), end=True)
    if dt_to:
        qs = qs.filter(created_at__lte=dt_to)

    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(summary__icontains=q)
            | Q(actor_email__icontains=q)
            | Q(action__icontains=q)
            | Q(ip_address__icontains=q)
            | Q(entity_id__icontains=q)
            | Q(organization__name__icontains=q)
        )
    return qs


def actor_display(r):
    """Who made the change, as the Logs tabs print it: the courier or
    Shopify when one of them did, else the person's email."""
    via = (r.metadata or {}).get("via")
    if via:
        return via
    if r.actor_email:
        return r.actor_email
    return "System"


def _row(r):
    return {
        "actor": actor_display(r),
        "id": str(r.id),
        "organization_id": str(r.organization_id) if r.organization_id else None,
        "organization_name": r.organization.name if r.organization_id else "FynkTech panel",
        "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
        "actor_email": r.actor_email,
        # Blank on rows from before roles were recorded.
        "actor_role": r.actor_role,
        "action": r.action,
        "category": r.category or category_for(r.action, r.request_path),
        "entity_type": r.entity_type,
        "entity_id": r.entity_id,
        "summary": r.summary,
        "metadata": r.metadata or {},
        "ip_address": r.ip_address,
        "user_agent": r.user_agent,
        "request_method": r.request_method,
        "request_path": r.request_path,
        "status_code": r.status_code,
        "created_at": r.created_at.isoformat(),
    }


def list_activity(params):
    """params: organization (uuid or "platform"), actor (store|store_admin|
    store_user|super_admin|system), category, outcome (ok|failed), q,
    from, to, entity_type + entity_id (one record's history), order
    (desc|asc - asc for a history), page, page_size (max 500)."""
    qs = _filtered(params).select_related("organization")
    qs = qs.order_by("created_at" if params.get("order") == "asc" else "-created_at")
    try:
        page = max(1, int(params.get("page") or 1))
        page_size = min(500, max(1, int(params.get("page_size") or 50)))
    except ValueError:
        page, page_size = 1, 50
    total = qs.count()
    start = (page - 1) * page_size
    return {
        "count": total,
        "page": page,
        "page_size": page_size,
        "results": [_row(r) for r in qs[start : start + page_size]],
    }
