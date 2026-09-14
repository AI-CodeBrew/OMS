"""Super-admin ticket queries/actions - business logic kept out of
admin_views.py, same split integrations/business_services.py uses for
Smartlane's admin API. Every read/write here is cross-org on purpose
(Ticket.all_objects), since a super admin's job is exactly to see and act
on tickets regardless of which organization raised them."""

from django.core.paginator import Paginator
from django.db.models import Q
from django.utils import timezone

from .models import Ticket, TicketMessage
from .serializers import AdminTicketSerializer, TicketMessageSerializer

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


class TicketAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _get_ticket(ticket_id):
    try:
        return Ticket.all_objects.select_related("organization", "order").get(id=ticket_id)
    except Ticket.DoesNotExist:
        raise TicketAdminError("Ticket not found.", 404)


def _int_param(value, default, maximum=None):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if n < 1:
        return default
    return min(n, maximum) if maximum else n


def list_tickets(params=None):
    """params is a query-params-like mapping (status, priority, q, mine,
    page, page_size). Manual pagination rather than DRF's automatic
    PageNumberPagination since these are plain @api_view functions, not a
    ModelViewSet - kept in the shape the frontend already expects
    ({success, tickets, count, page, page_size})."""

    params = params or {}
    qs = Ticket.all_objects.select_related("organization", "order").order_by("-created_at")

    status_filter = params.get("status")
    if status_filter:
        qs = qs.filter(status=status_filter)

    priority_filter = params.get("priority")
    if priority_filter:
        qs = qs.filter(priority=priority_filter)

    # "Unassigned" / "Assigned to me" are the two admin-side triage filters
    # that matter in practice - "mine" resolves against the caller, passed
    # in explicitly rather than read from a global here.
    assigned = params.get("assigned")
    if assigned == "unassigned":
        qs = qs.filter(assigned_to_user_id__isnull=True)
    elif assigned:
        qs = qs.filter(assigned_to_user_id=assigned)

    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(category__icontains=q)
            | Q(sub_category__icontains=q)
            | Q(description__icontains=q)
            | Q(created_by_email__icontains=q)
            | Q(organization__name__icontains=q)
            | Q(order__order_number__icontains=q)
        )

    page_size = _int_param(params.get("page_size"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    page_number = _int_param(params.get("page"), 1)
    paginator = Paginator(qs, page_size)
    page = paginator.get_page(page_number)

    return {
        "tickets": AdminTicketSerializer(page.object_list, many=True).data,
        "count": paginator.count,
        "page": page.number,
        "page_size": page_size,
        "num_pages": paginator.num_pages,
    }


def get_ticket(ticket_id):
    """Retrieving a ticket is also how a super admin acknowledges it -
    opening it flips open -> seen, same as reading a mention."""
    ticket = _get_ticket(ticket_id)
    if ticket.status == "open":
        ticket.status = "seen"
        ticket.save(update_fields=["status"])
    return AdminTicketSerializer(ticket).data


def resolve_ticket(ticket_id, *, actor_user_id=None):
    ticket = _get_ticket(ticket_id)
    ticket.status = "resolved"
    ticket.resolved_at = timezone.now()
    ticket.resolved_by_user_id = actor_user_id
    ticket.save(update_fields=["status", "resolved_at", "resolved_by_user_id"])
    return AdminTicketSerializer(ticket).data


def assign_ticket(ticket_id, *, actor_user_id, actor_email):
    """Claim/unclaim - POSTing with the same actor again unassigns, so the
    UI can offer one toggling "Assign to me" button rather than a separate
    unassign action."""
    ticket = _get_ticket(ticket_id)
    if ticket.assigned_to_user_id == actor_user_id:
        ticket.assigned_to_user_id = None
        ticket.assigned_to_email = ""
    else:
        ticket.assigned_to_user_id = actor_user_id
        ticket.assigned_to_email = actor_email or ""
    ticket.save(update_fields=["assigned_to_user_id", "assigned_to_email"])
    return AdminTicketSerializer(ticket).data


def set_priority(ticket_id, priority):
    if priority not in dict(Ticket.PRIORITY_CHOICES):
        raise TicketAdminError(f"Invalid priority: {priority!r}.", 400)
    ticket = _get_ticket(ticket_id)
    ticket.priority = priority
    ticket.save(update_fields=["priority"])
    return AdminTicketSerializer(ticket).data


def list_messages(ticket_id):
    ticket = _get_ticket(ticket_id)
    return TicketMessageSerializer(ticket.messages.all(), many=True).data


def add_admin_message(ticket_id, body, *, actor_user_id=None, actor_email="", is_internal=False):
    ticket = _get_ticket(ticket_id)
    body = (body or "").strip()
    if not body:
        raise TicketAdminError("body is required.", 400)
    message = TicketMessage.all_objects.create(
        organization_id=ticket.organization_id,
        ticket=ticket,
        body=body,
        author_user_id=actor_user_id,
        author_role="super_admin",
        author_email=actor_email,
        is_internal=bool(is_internal),
    )
    # A superadmin replying has necessarily seen it - fold "seen" into this
    # transition too, not just an explicit open (a ticket could still be
    # "open" here if the reply came from a fresh GET that raced this POST).
    # An internal note is invisible to the customer, so it shouldn't move
    # the ticket's customer-facing status at all.
    if not is_internal and ticket.status in ("open", "seen"):
        ticket.status = "in_progress"
        ticket.save(update_fields=["status"])
    return TicketMessageSerializer(message).data
