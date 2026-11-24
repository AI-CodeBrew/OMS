"""Super admin's city list (see city_admin_services). Mounted under
/api/core/admin/cities/ so AdminIPAllowlistMiddleware covers it, same as
the other admin views (see admin_views' docstring)."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.permissions import IsSuperAdmin

from . import city_admin_services as service
from .city_admin_services import CityAdminError


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def cities(request):
    if request.method == "POST":
        names = (request.data or {}).get("names") or []
        if isinstance(names, str):
            names = names.splitlines()
        added = service.add_cities(names)
        return Response({"success": True, "added": added, **service.list_cities()}, status=201)
    params = request.query_params
    return Response(
        {"success": True, **service.list_cities(params.get("q", ""), params.get("province", ""))}
    )


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperAdmin])
def city_detail(request, city_id):
    """PATCH {province} - set the city's province; DELETE - remove it."""
    try:
        if request.method == "PATCH":
            city = service.set_province(city_id, (request.data or {}).get("province"))
            return Response({"success": True, "city": city})
        service.delete_city(city_id)
    except CityAdminError as exc:
        return Response({"success": False, "error": exc.message}, status=exc.status_code)
    return Response({"success": True})


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def city_import(request):
    return Response({"success": True, **service.import_from_couriers(), **service.list_cities()})


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def spellings(request):
    """The spellings Fix Cities learned from people's fixes."""
    return Response({"success": True, **service.list_spellings(request.query_params.get("q", ""))})


@api_view(["DELETE"])
@permission_classes([IsSuperAdmin])
def spelling_detail(request, spelling_id):
    """Forget one learned spelling (a wrong one)."""
    try:
        service.delete_spelling(spelling_id)
    except CityAdminError as exc:
        return Response({"success": False, "error": exc.message}, status=exc.status_code)
    return Response({"success": True})
