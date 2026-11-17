from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import activity_log_service, dispatch_hub_service
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
    """GET the org; PATCH {"is_active": bool} suspends or reactivates it,
    PATCH {"service_model": "..."} sets its service model (Stores tab);
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
            if "shopify_resync_orders" in body:
                org = service.set_shopify_resync(
                    organization_id,
                    enabled=body.get("shopify_resync_orders"),
                    actor_user_id=request.user_id,
                    actor_email=actor_email,
                )
                return Response({"success": True, "organization": org})
            if "service_model" in body:
                org = service.set_service_model(
                    organization_id,
                    service_model=body.get("service_model"),
                    actor_user_id=request.user_id,
                    actor_email=actor_email,
                )
                return Response({"success": True, "organization": org})
            if "is_active" not in body:
                raise OrganizationAdminError("Nothing to update - send is_active or service_model.")
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


@api_view(["POST", "DELETE"])
@permission_classes([IsSuperAdmin])
def organization_stores(request, organization_id):
    """An organization's stores (core.org_group). POST {"store_id"} puts
    that store inside this organization; DELETE {"store_id"} takes it out."""
    from . import org_group

    body = request.data or {}
    actor_email = getattr(request, "auth_email", "") or ""
    store_id = body.get("store_id")
    if not store_id:
        return Response({"success": False, "error": "Pick a store."}, status=400)
    try:
        if request.method == "POST":
            result = org_group.link_store(
                parent_id=organization_id, store_id=store_id,
                actor_user_id=request.user_id, actor_email=actor_email,
            )
        else:
            parent = org_group.root_id(store_id)
            if str(parent) != str(organization_id):
                return Response({"success": False, "error": "That store isn't inside this organization."}, status=400)
            result = org_group.unlink_store(store_id=store_id, actor_user_id=request.user_id, actor_email=actor_email)
    except org_group.OrgGroupError as exc:
        return Response({"success": False, "error": exc.message}, status=exc.status_code)
    return Response({"success": True, **result, "organization": service.get_organization(organization_id)})


@api_view(["PATCH"])
@permission_classes([IsSuperAdmin])
def update_member(request, user_id):
    body = request.data or {}
    try:
        result = service.update_member_credentials(
            user_id,
            email=body.get("email"),
            password=body.get("password"),
            # The store whose member this is - a login can belong to more
            # than one, and only this store's is changed.
            organization_id=body.get("organization_id"),
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
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
        # ?scope=all: every store (the All Orders tab's store filter).
        if request.query_params.get("scope") == dispatch_hub_service.ALL_STORES_SCOPE:
            return Response({"success": True, "stores": dispatch_hub_service.list_all_stores()})
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


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def activity_logs(request):
    """Every store's activity log, newest first - see
    activity_log_service.list_activity for the filters."""
    return Response({"success": True, **activity_log_service.list_activity(request.query_params)})


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def order_logs(request):
    """The Logs page's Order Logs tab, across every store - see
    activity_log_service.order_logs."""
    return Response({"success": True, **activity_log_service.order_logs(request.query_params)})


# ------------------------------------------------ Super admin Admin Team --

def _owner_only(request):
    if not getattr(request, "is_admin_owner", False):
        return Response(
            {"success": False, "error": "Only an owner super admin can manage the admin team and roles."},
            status=403,
        )
    return None


def _team_error(exc):
    return Response({"success": False, "error": exc.message}, status=exc.status_code)


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def admin_me(request):
    """This super admin login's own access - the panel's sidebar and
    read-only notes use it. is_owner: everything, including Admin Team."""
    from . import admin_pages

    owner = bool(getattr(request, "is_admin_owner", False))
    permissions = (
        {p: admin_pages.WRITE for p in admin_pages.PAGE_KEYS} if owner else (request.admin_permissions or {})
    )
    return Response({
        "success": True, "is_owner": owner, "permissions": permissions, "pages": admin_pages.PAGES,
        # Store pages it may use inside the Dispatch Hub (null = all).
        "hub_pages": None if owner else admin_pages.hub_store_permissions(permissions),
        # Hub pages but not the Hub's own page: Dispatch Hub opens straight
        # into the Hub.
        "hub_direct": (not owner) and not permissions.get("dispatch_hub")
        and bool(admin_pages.hub_store_permissions(permissions)),
    })


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def admin_team(request):
    """GET: the Admin Team page (staff logins, roles, the page list).
    POST {email, password, name, role_id | permissions}: a new staff login."""
    from . import admin_team_service as team

    denied = _owner_only(request)
    if denied:
        return denied
    if request.method == "GET":
        return Response({"success": True, **team.overview()})
    body = request.data or {}
    try:
        staff = team.create_staff(
            email=body.get("email"), password=body.get("password"), name=body.get("name") or "",
            role_id=body.get("role_id") or None, permissions=body.get("permissions"),
            actor_user_id=request.user_id, actor_email=getattr(request, "auth_email", "") or "",
        )
    except team.AdminTeamError as exc:
        return _team_error(exc)
    return Response({"success": True, "staff": staff}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperAdmin])
def admin_team_member(request, user_id):
    """PATCH {name?, password?, role_id | permissions (with "access": true)};
    DELETE removes the login."""
    from . import admin_team_service as team

    denied = _owner_only(request)
    if denied:
        return denied
    actor = {"actor_user_id": request.user_id, "actor_email": getattr(request, "auth_email", "") or ""}
    try:
        if request.method == "DELETE":
            return Response({"success": True, **team.remove_staff(user_id, **actor)})
        body = request.data or {}
        staff = team.update_staff(
            user_id, name=body.get("name"), role_id=body.get("role_id") or None,
            permissions=body.get("permissions"), set_access=bool(body.get("access")),
            password=body.get("password") or None, **actor,
        )
    except team.AdminTeamError as exc:
        return _team_error(exc)
    return Response({"success": True, "staff": staff})


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def admin_roles(request):
    from . import admin_team_service as team

    denied = _owner_only(request)
    if denied:
        return denied
    if request.method == "GET":
        return Response({"success": True, "roles": team.overview()["roles"]})
    body = request.data or {}
    try:
        role = team.create_role(
            name=body.get("name"), permissions=body.get("permissions"),
            actor_user_id=request.user_id, actor_email=getattr(request, "auth_email", "") or "",
        )
    except team.AdminTeamError as exc:
        return _team_error(exc)
    return Response({"success": True, "role": role}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperAdmin])
def admin_role_detail(request, role_id):
    from . import admin_team_service as team

    denied = _owner_only(request)
    if denied:
        return denied
    actor = {"actor_user_id": request.user_id, "actor_email": getattr(request, "auth_email", "") or ""}
    try:
        if request.method == "DELETE":
            return Response({"success": True, **team.delete_role(role_id, **actor)})
        body = request.data or {}
        role = team.update_role(
            role_id, name=body.get("name"),
            permissions=body.get("permissions") if "permissions" in body else None, **actor,
        )
    except team.AdminTeamError as exc:
        return _team_error(exc)
    return Response({"success": True, "role": role})
