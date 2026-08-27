from django.db import connection
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response


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
    """Minimal probe for Render / curl — body is just `ok`."""
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
