from django.db import connection
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Public liveness/readiness probe — no auth required."""
    db_ok = False
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        db_ok = True
    except Exception:
        db_ok = False

    status = "ok" if db_ok else "degraded"
    payload = {
        "success": db_ok,
        "status": status,
        "service": "oms-backend",
        "database": "ok" if db_ok else "error",
        "timestamp": timezone.now().isoformat(),
    }
    return Response(payload, status=200 if db_ok else 503)


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
