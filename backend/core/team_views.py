from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import activity_log_service, role_service, team_service
from .permissions import CanManageTeam, IsOrgAdmin
from .role_service import RoleError
from .team_service import TeamAdminError


def _limit_to_modules(request):
    """Only the store admin (or super admin) manages staff logins - no
    limits (CanManageTeam lets no one else in)."""
    return None


def _actor(request):
    return {"actor_user_id": request.user_id, "actor_email": getattr(request, "auth_email", "") or ""}


def _role_error(exc):
    return Response({"success": False, "error": exc.message, "code": "role_error"}, status=exc.status_code)


@api_view(["GET", "POST"])
@permission_classes([CanManageTeam])
def roles(request):
    org_id = request.organization_id
    if request.method == "GET":
        return Response({"success": True, **role_service.list_roles(org_id)})
    body = request.data or {}
    try:
        role = role_service.create_role(
            organization_id=org_id, name=body.get("name"), permissions=body.get("permissions"), **_actor(request)
        )
    except RoleError as exc:
        return _role_error(exc)
    return Response({"success": True, "role": role}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([CanManageTeam])
def role_detail(request, role_id):
    org_id = request.organization_id
    try:
        if request.method == "DELETE":
            return Response(role_service.delete_role(organization_id=org_id, role_id=role_id, **_actor(request)))
        body = request.data or {}
        role = role_service.update_role(
            organization_id=org_id,
            role_id=role_id,
            name=body.get("name") if "name" in body else None,
            permissions=body.get("permissions") if "permissions" in body else None,
            **_actor(request),
        )
    except RoleError as exc:
        return _role_error(exc)
    return Response({"success": True, "role": role})


@api_view(["GET", "POST"])
@permission_classes([CanManageTeam])
def team_members(request):
    org_id = request.organization_id
    if request.method == "GET":
        data = team_service.list_team(org_id, limit_to_modules=_limit_to_modules(request))
        return Response({"success": True, **data})

    body = request.data or {}
    try:
        member = team_service.invite_team_member(
            organization_id=org_id,
            username=body.get("username"),
            email=body.get("email"),
            password=body.get("password"),
            modules=body.get("modules"),
            module=body.get("module"),
            role_id=body.get("role_id"),
            permissions=body.get("permissions"),
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
            limit_to_modules=_limit_to_modules(request),
        )
    except TeamAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "team_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "member": member}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([CanManageTeam])
def team_member_detail(request, user_id):
    org_id = request.organization_id
    if request.method == "DELETE":
        try:
            result = team_service.remove_team_member(
                organization_id=org_id,
                user_id=user_id,
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
                limit_to_modules=_limit_to_modules(request),
            )
        except TeamAdminError as exc:
            return Response(
                {"success": False, "error": exc.message, "code": "team_admin_error"},
                status=exc.status_code,
            )
        return Response({"success": True, **result})

    body = request.data or {}
    try:
        member = team_service.update_team_member(
            organization_id=org_id,
            user_id=user_id,
            modules=body.get("modules") if "modules" in body else None,
            module=body.get("module") if "module" in body else None,
            username=body.get("username") if "username" in body else None,
            email=body.get("email") if "email" in body else None,
            password=body.get("password") if "password" in body else None,
            role_id=body.get("role_id") if "role_id" in body else None,
            permissions=body.get("permissions") if "permissions" in body else None,
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
            limit_to_modules=_limit_to_modules(request),
        )
    except TeamAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "team_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "member": member})


@api_view(["GET"])
@permission_classes([IsOrgAdmin])
def audit_logs(request):
    """The store's own Logs tab - same rows and filters as the super
    admin's (activity_log_service.list_activity), locked to this store."""
    if not request.organization_id:
        return Response({"success": True, "count": 0, "page": 1, "page_size": 50, "results": []})
    params = {
        key: request.query_params.get(key)
        for key in ("from", "to", "q", "entity_type", "entity_id", "order", "page", "page_size")
    }
    params["organization"] = request.organization_id
    return Response({"success": True, **activity_log_service.list_activity(params)})
