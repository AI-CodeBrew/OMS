from django.db import connection
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import scan_sessions, store_service
from .permissions import IsAuthenticatedTenant, IsOrgAdmin
from .store_service import StoreAdminError


def _db_ok():
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return True
    except Exception:
        return False


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def scan_session(request):
    """A laptop's Scan panel asking to pair a phone as its scanner - see
    core/scan_sessions.py."""
    return Response(scan_sessions.create_session(request))


@api_view(["GET"])
@permission_classes([AllowAny])
def health_plain(request):
    """Minimal probe for uptime checks / curl — body is just `ok`."""
    if _db_ok():
        return HttpResponse("ok", content_type="text/plain", status=200)
    return HttpResponse("error", content_type="text/plain", status=503)


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """JSON health used by the frontend (`/api/core/health/`)."""
    db_ok = _db_ok()
    return Response(
        {
            "success": db_ok,
            "status": "ok" if db_ok else "degraded",
            "service": "oms-backend",
            "database": "ok" if db_ok else "error",
            "timestamp": timezone.now().isoformat(),
        },
        status=200 if db_ok else 503,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def health_protected(request):
    role = (getattr(request, "auth_claims", None) or {}).get("app_metadata", {}).get("role")
    return Response(
        {
            "success": True,
            "status": "ok",
            "user_id": request.user_id,
            "organization_id": request.organization_id,
            "role": role,
            # Live access from the Membership row (TenantMiddleware), so the
            # frontend can tell its JWT snapshot is stale and refresh it.
            "access": None
            if getattr(request, "is_super_admin", False)
            else {
                "role": "org_admin" if request.is_org_admin else "org_user",
                "modules": list(request.modules or []),
                # Staff: {page: "read"|"write"} from their role (core.pages);
                # None for a store admin - every page their store has.
                "pages": getattr(request, "page_permissions", None),
            },
            "timestamp": timezone.now().isoformat(),
        }
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedTenant])
def stores(request):
    """GET: every store this login belongs to (current store first).
    POST: add a new store to this same login - either another Shopify
    store or a manual (CSV-only) one - and make the caller its org admin.
    A super admin acting as a store manages that store, not their own
    stores list, so this is org-admin only, same as team management."""
    # Staff given access to several stores of an organization list (and
    # switch between) them too; only an admin adds stores.
    if request.method == "GET":
        data = store_service.list_my_stores(request.user_id, request.organization_id)
        return Response({"success": True, "stores": data})

    # A super admin acting as a store passes IsOrgAdmin, but create_store
    # would give the super admin's own login a Membership in the new store
    # and the switch that follows would rewrite its role to org_admin -
    # locking it out of the super admin console (happened: "sufyan").
    if getattr(request, "is_super_admin", False):
        return Response(
            {"success": False, "error": "A super admin can't add stores from inside a store - "
             "add the store from the store owner's login, or use Organizations → Add store."},
            status=403,
        )
    if not IsOrgAdmin().has_permission(request, None):
        return Response({"success": False, "error": "Only the store admin can add stores."}, status=403)
    body = request.data or {}
    try:
        store = store_service.create_store(
            user_id=request.user_id,
            source_organization_id=request.organization_id,
            name=body.get("name"),
            is_manual_store=bool(body.get("is_manual_store")),
        )
    except StoreAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "store_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "store": store}, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticatedTenant])
def switch_store(request):
    """Points this login's JWT at another store it already belongs to.
    Returns no session itself - Supabase issued the current one, so the
    frontend calls supabase.auth.refreshSession() right after this to pick
    up the app_metadata this just wrote."""
    # Switching rewrites the login's role claim to the store's - a super
    # admin would lose the super admin console (see stores above).
    if getattr(request, "is_super_admin", False):
        return Response(
            {"success": False, "error": "A super admin enters stores from the admin console, not by switching."},
            status=403,
        )
    organization_id = (request.data or {}).get("organization_id")
    if not organization_id:
        return Response(
            {"success": False, "error": "organization_id is required"}, status=400
        )
    try:
        store_service.switch_store(
            user_id=request.user_id,
            organization_id=organization_id,
            actor_email=getattr(request, "auth_email", "") or "",
        )
    except StoreAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "store_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True})
