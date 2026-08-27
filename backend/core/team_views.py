from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import team_service
from .permissions import IsOrgAdmin
from .team_service import TeamAdminError


@api_view(["GET", "POST"])
@permission_classes([IsOrgAdmin])
def team_members(request):
    org_id = request.organization_id
    if request.method == "GET":
        data = team_service.list_team(org_id)
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
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
        )
    except TeamAdminError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "team_admin_error"},
            status=exc.status_code,
        )
    return Response({"success": True, "member": member}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsOrgAdmin])
def team_member_detail(request, user_id):
    org_id = request.organization_id
    if request.method == "DELETE":
        try:
            result = team_service.remove_team_member(
                organization_id=org_id,
                user_id=user_id,
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
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
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
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
    data = team_service.list_audit_logs(
        organization_id=request.organization_id,
        date_from=request.query_params.get("from") or request.query_params.get("date_from"),
        date_to=request.query_params.get("to") or request.query_params.get("date_to"),
        page=request.query_params.get("page") or 1,
        page_size=request.query_params.get("page_size") or 50,
    )
    return Response({"success": True, **data})
