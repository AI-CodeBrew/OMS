from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"success": True, "status": "ok", "service": "oms-backend"})


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
        }
    )
