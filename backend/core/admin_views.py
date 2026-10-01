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


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsSuperAdmin])
def organization_detail(request, organization_id):
    """GET the org; PATCH {"is_active": bool} suspends or reactivates it;
    DELETE {"confirm_name": "<exact org name>"} removes it permanently."""
    body = request.data or {}
    actor_email = getattr(request, "auth_email", "") or ""
    try:
        if request.method == "DELETE":
            result = service.delete_organization(
                organization_id, confirm_name=body.get("confirm_name"), actor_email=actor_email
            )
            return Response({"success": True, **result})
        if request.method == "PATCH":
            if "is_active" not in body:
                raise OrganizationAdminError("Nothing to update - send is_active.")
            org = service.set_organization_active(
                organization_id,
                is_active=body.get("is_active"),
                actor_user_id=request.user_id,
                actor_email=actor_email,
            )
        else:
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
