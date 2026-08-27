from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import organization_admin_service as service
from .organization_admin_service import OrganizationAdminError
from .permissions import IsSuperAdmin


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def organizations(request):
    if request.method == "GET":
        include_emails = str(request.query_params.get("include_emails", "")).lower() in {
            "1",
            "true",
            "yes",
        }
        return Response(
            {
                "success": True,
                "organizations": service.list_organizations(
                    include_emails=include_emails
                ),
            }
        )

    body = request.data or {}
    try:
        org = service.create_organization_with_admin(
            name=body.get("name"),
            email=body.get("email"),
            password=body.get("password"),
            plan=body.get("plan", "starter"),
            slug=body.get("slug"),
            modules=body.get("modules"),
        )
    except OrganizationAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "organization_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "organization": org}, status=201)


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def organization_detail(request, organization_id):
    try:
        org = service.get_organization(organization_id)
    except OrganizationAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "organization_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "organization": org})


@api_view(["PATCH"])
@permission_classes([IsSuperAdmin])
def update_member(request, user_id):
    body = request.data or {}
    try:
        result = service.update_member_credentials(
            user_id,
            email=body.get("email"),
            password=body.get("password"),
        )
    except OrganizationAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "organization_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "member": result})
