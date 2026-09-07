"""Super-admin-only Business API views.

Mounted under /api/core/admin/smartlane/ from core/urls.py rather than under
/api/integrations/. That prefix is not cosmetic: AdminIPAllowlistMiddleware
matches the literal string "/api/core/admin/", so a route registered
anywhere else would silently lose the IP gate while still looking
super-admin-only.
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.permissions import IsSuperAdmin

from . import business_services as service
from .business_services import SmartlaneBusinessError


def _error(exc):
    return Response(
        {"success": False, "error": exc.message, "code": "smartlane_business_error"},
        status=exc.status_code,
    )


@api_view(["GET", "PUT"])
@permission_classes([IsSuperAdmin])
def business_config(request):
    if request.method == "GET":
        return Response({"success": True, "config": service.get_config()})

    try:
        config = service.update_config(request.data or {})
    except SmartlaneBusinessError as exc:
        return _error(exc)
    return Response({"success": True, "config": config})


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def courier_offerings(request):
    if request.method == "GET":
        return Response({"success": True, "couriers": service.list_offerings()})

    try:
        courier = service.create_offering(request.data or {})
    except SmartlaneBusinessError as exc:
        return _error(exc)
    return Response({"success": True, "courier": courier}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperAdmin])
def courier_offering_detail(request, offering_id):
    try:
        if request.method == "DELETE":
            service.delete_offering(offering_id)
            return Response({"success": True})
        courier = service.update_offering(offering_id, request.data or {})
    except SmartlaneBusinessError as exc:
        return _error(exc)
    return Response({"success": True, "courier": courier})


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def business_config_test(request):
    """Deliberately answers 200 even when Smartlane rejects us - the body's
    `ok` flag carries that. A failed handshake is a normal, expected result
    the page needs to render in full (including the signing inputs), not an
    HTTP error to be swallowed by the frontend's throw-on-!ok helper."""
    try:
        result = service.test_connection()
    except SmartlaneBusinessError as exc:
        return _error(exc)
    return Response({"success": True, **result})
