from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import notification_service as service
from .permissions import IsAuthenticatedTenant


@api_view(["GET"])
@permission_classes([IsAuthenticatedTenant])
def notifications(request):
    """The store's bell. Nothing outside a single store (the super admin's
    own panel, or the Dispatch Hub spanning several)."""
    if not request.organization_id:
        return Response({"success": True, "notifications": [], "unread_count": 0})
    return Response({"success": True, **service.recent(request.organization_id)})


@api_view(["POST"])
@permission_classes([IsAuthenticatedTenant])
def notifications_read(request):
    """POST {ids?} - marks them (or every one) read. A super admin looking at
    a store's bell doesn't mark anything: they're the store's to read."""
    if not request.organization_id or getattr(request, "is_super_admin", False):
        return Response({"success": True, "marked": 0})
    ids = (request.data or {}).get("ids") or None
    return Response({"success": True, "marked": service.mark_read(request.organization_id, ids)})
