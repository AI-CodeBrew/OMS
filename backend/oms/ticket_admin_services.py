"""Super-admin ticket queries/actions - business logic kept out of
admin_views.py, same split integrations/business_services.py uses for
Smartlane's admin API. Every read/write here is cross-org on purpose
(Ticket.all_objects), since a super admin's job is exactly to see and act
on tickets regardless of which organization raised them."""

from django.core.paginator import Paginator
from django.db.models import Q
from django.utils import timezone

from core.models import Organization

from .models import Order, Ticket, TicketMessage
from .serializers import AdminTicketSerializer, TicketMessageSerializer, TicketSerializer

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
    """params is a query-params-like mapping (status, type, q,
    page, page_size). Manual pagination rather than DRF's automatic
    PageNumberPagination since these are plain @api_view functions, not a
    ModelViewSet - kept in the shape the frontend already expects
    ({success, tickets, count, page, page_size})."""

    params = params or {}
    qs = Ticket.all_objects.select_related("organization", "order").order_by("-created_at")

    type_filter = params.get("type")
    if type_filter:
        qs = qs.filter(ticket_type=type_filter)

    q = (params.get("q") or "").strip()
    if q:
        condition = (
            Q(category__icontains=q)
            | Q(sub_category__icontains=q)
            | Q(description__icontains=q)
            | Q(created_by_email__icontains=q)
            | Q(organization__name__icontains=q)
            | Q(order__order_number__icontains=q)
        )
        # "#000123" / "000123" / "123" finds that ticket by its number.
        number = q.removeprefix("#").lstrip("0")
        if number.isdigit():
            condition |= Q(number=int(number))
        qs = qs.filter(condition)

    status_filter = params.get("status")
    if status_filter:
        qs = qs.filter(status=status_filter)

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


def create_ticket(data, *, actor_user_id=None, actor_email=""):
    """FynkTech raising a ticket to a store (`organization_id`, required),
    optionally on one of that store's orders. Always "By Admin" - it shows
    under that store's By Admin tickets. Same field rules as a store's own
    ticket (TicketSerializer: category required, description 10+ chars)."""
    data = data or {}
    organization_id = data.get("organization_id")
    if not organization_id or not Organization.objects.filter(
        id=organization_id, is_platform=False
    ).exists():
        raise TicketAdminError("Pick the store this ticket is for.", 400)
    order_id = data.get("order") or None
    if order_id and not Order.all_objects.filter(id=order_id, organization_id=organization_id).exists():
        raise TicketAdminError("That order isn't one of this store's.", 400)

    serializer = TicketSerializer(
        data={
            "category": data.get("category", ""),
            "sub_category": data.get("sub_category", ""),
            "description": data.get("description", ""),
        }
    )
    if not serializer.is_valid():
        field, errors = next(iter(serializer.errors.items()))
        raise TicketAdminError(f"{field.replace('_', ' ').capitalize()}: {errors[0]}", 400)
    ticket = Ticket.all_objects.create(
        organization_id=organization_id,
        order_id=order_id,
        **serializer.validated_data,
        status="open",
        ticket_type="admin",
        created_by_user_id=actor_user_id,
        created_by_email=actor_email or "",
    )
    return AdminTicketSerializer(_get_ticket(ticket.id)).data


def search_store_orders(organization_id, q, limit=8):
    """The New ticket form's order picker: one store's orders matching `q`
    (order no., OMS id, customer, phone), newest first."""
    q = (q or "").strip()
    if not organization_id or not q:
        return []
    condition = (
        Q(order_number__icontains=q) | Q(customer_name__icontains=q) | Q(customer_phone__icontains=q)
    )
    if q.isdigit():
        condition |= Q(supabase_order_no=int(q))
    rows = (
        Order.all_objects.filter(condition, organization_id=organization_id)
        .order_by("-created_at")
        .values("id", "order_number", "supabase_order_no", "customer_name")[:limit]
    )
    return [{**r, "id": str(r["id"])} for r in rows]


def get_ticket(ticket_id):
    return AdminTicketSerializer(_get_ticket(ticket_id)).data


def set_status(ticket_id, new_status, *, actor_user_id=None):
    """The admin's ticket actions - any status to any other. Resolving
    stamps who/when; moving away from resolved clears that again."""
    if new_status not in dict(Ticket.STATUS_CHOICES):
        raise TicketAdminError(f"Invalid status: {new_status!r}.", 400)
    ticket = _get_ticket(ticket_id)
    ticket.status = new_status
    if new_status == "resolved":
        ticket.resolved_at = timezone.now()
        ticket.resolved_by_user_id = actor_user_id
    else:
        ticket.resolved_at = None
        ticket.resolved_by_user_id = None
    ticket.save(update_fields=["status", "resolved_at", "resolved_by_user_id"])
    return AdminTicketSerializer(ticket).data


def resolve_ticket(ticket_id, *, actor_user_id=None):
    return set_status(ticket_id, "resolved", actor_user_id=actor_user_id)


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
    # A superadmin replying means it's being worked on. An internal note is
    # invisible to the customer, so it shouldn't move the ticket's
    # customer-facing status at all.
    if not is_internal and ticket.status in ("open", "pending"):
        ticket.status = "in_progress"
        ticket.save(update_fields=["status"])
    return TicketMessageSerializer(message).data
