"""Super-admin-only ticket views.

Mounted under /api/core/admin/tickets/ from core/urls.py rather than under
/api/oms/. That prefix is not cosmetic: AdminIPAllowlistMiddleware matches
the literal string "/api/core/admin/", so a route registered anywhere else
would silently lose the IP gate while still looking super-admin-only. Same
pattern as integrations/admin_views.py for Smartlane.
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.permissions import IsSuperAdmin

from . import ticket_admin_services as service
from .ticket_admin_services import TicketAdminError


def _error(exc):
    return Response({"success": False, "error": exc.message}, status=exc.status_code)


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def tickets(request):
    result = service.list_tickets(request.query_params)
    return Response({"success": True, **result})


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def ticket_detail(request, ticket_id):
    try:
        ticket = service.get_ticket(ticket_id)
    except TicketAdminError as exc:
        return _error(exc)
    return Response({"success": True, "ticket": ticket})


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def ticket_resolve(request, ticket_id):
    try:
        ticket = service.resolve_ticket(ticket_id, actor_user_id=getattr(request, "user_id", None))
    except TicketAdminError as exc:
        return _error(exc)
    return Response({"success": True, "ticket": ticket})


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def ticket_assign(request, ticket_id):
    try:
        ticket = service.assign_ticket(
            ticket_id,
            actor_user_id=getattr(request, "user_id", None),
            actor_email=getattr(request, "auth_email", "") or "",
        )
    except TicketAdminError as exc:
        return _error(exc)
    return Response({"success": True, "ticket": ticket})


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def ticket_priority(request, ticket_id):
    try:
        ticket = service.set_priority(ticket_id, (request.data or {}).get("priority", ""))
    except TicketAdminError as exc:
        return _error(exc)
    return Response({"success": True, "ticket": ticket})


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def ticket_messages(request, ticket_id):
    try:
        if request.method == "POST":
            message = service.add_admin_message(
                ticket_id,
                (request.data or {}).get("body", ""),
                actor_user_id=getattr(request, "user_id", None),
                actor_email=getattr(request, "auth_email", "") or "",
                is_internal=bool((request.data or {}).get("is_internal")),
            )
            return Response({"success": True, "message": message}, status=201)
        return Response({"success": True, "messages": service.list_messages(ticket_id)})
    except TicketAdminError as exc:
        return _error(exc)
