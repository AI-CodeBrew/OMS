from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import dispatch_hub_service
from . import organization_admin_service as service
from .dispatch_hub_service import DispatchHubError
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


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def dispatch_hub_stores(request):
    """GET the Hub roster; POST {"organization_id", "per_order_rate"} adds
    a store to it (or updates its rate if it's already in)."""
    if request.method == "GET":
        return Response({"success": True, "stores": dispatch_hub_service.list_hub_stores()})

    body = request.data or {}
    organization_id = body.get("organization_id")
    if not organization_id:
        return Response(
            {"success": False, "error": "organization_id is required"}, status=400
        )
    try:
        dispatch_hub_service.add_to_hub(
            organization_id,
            per_order_rate=body.get("per_order_rate") or 0,
            actor_user_id=request.user_id,
        )
    except DispatchHubError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "dispatch_hub_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "stores": dispatch_hub_service.list_hub_stores()}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperAdmin])
def dispatch_hub_store_detail(request, organization_id):
    """PATCH {"per_order_rate"} updates the rate; DELETE removes the store
    from the Hub (its own data and connections are untouched)."""
    try:
        if request.method == "DELETE":
            dispatch_hub_service.remove_from_hub(organization_id, actor_user_id=request.user_id)
        else:
            body = request.data or {}
            if "per_order_rate" not in body:
                raise DispatchHubError("Nothing to update - send per_order_rate.")
            dispatch_hub_service.update_rate(organization_id, body.get("per_order_rate"))
    except DispatchHubError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "dispatch_hub_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "stores": dispatch_hub_service.list_hub_stores()})
