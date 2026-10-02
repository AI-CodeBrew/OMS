from django.db import connection
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import store_service
from .permissions import IsOrgAdmin
from .store_service import StoreAdminError


def _db_ok():
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return True
    except Exception:
        return False


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
            "timestamp": timezone.now().isoformat(),
        }
    )


@api_view(["GET", "POST"])
@permission_classes([IsOrgAdmin])
def stores(request):
    """GET: every store this login belongs to (current store first).
    POST: add a new store to this same login - either another Shopify
    store or a manual (CSV-only) one - and make the caller its org admin.
    A super admin acting as a store manages that store, not their own
    stores list, so this is org-admin only, same as team management."""
    if request.method == "GET":
        data = store_service.list_my_stores(request.user_id, request.organization_id)
        return Response({"success": True, "stores": data})

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
@permission_classes([IsOrgAdmin])
def switch_store(request):
    """Points this login's JWT at another store it already belongs to.
    Returns no session itself - Supabase issued the current one, so the
    frontend calls supabase.auth.refreshSession() right after this to pick
    up the app_metadata this just wrote."""
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
