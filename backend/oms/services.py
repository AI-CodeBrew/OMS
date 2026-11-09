import logging
import re
from datetime import timedelta
from zoneinfo import ZoneInfo
from decimal import Decimal

from django.db import transaction
from django.db.models import BooleanField, Count, DateTimeField, ExpressionWrapper, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone

from core.events import publish_event

from .models import Courier, Order, OrderItem, OrderStatusEvent

logger = logging.getLogger(__name__)


def create_order(*, organization_id, order_number, customer_name, customer_phone, items,
                 extra_fields=None, note=""):
    """Business logic for order creation lives here, not in the view - keeps
    OrderViewSet thin and gives WMS/Finance one place (the order.created
    event) to react to without importing oms's models directly.

    `extra_fields` are further Order columns from the Manual Order form
    (address, city, email, payment method, shipping, ...); `note` becomes
    the order's first note."""
    from .models import OrderNote

    # shop / order_source can be overridden through extra_fields - a
    # recreated order keeps the store name of the order it came from.
    fields = {"shop": "Manual", "order_source": "Manual", **(extra_fields or {})}
    order = Order.objects.create(
        organization_id=organization_id,
        order_number=order_number,
        customer_name=customer_name,
        customer_phone=customer_phone or "",
        status="new",
        **fields,
    )

    total = 0
    for item in items:
        order_item = order.items.create(
            organization_id=organization_id,
            product_name=item["product_name"],
            quantity=item["quantity"],
            unit_price=item["unit_price"],
            barcode=item.get("barcode") or "",
            weight_grams=item.get("weight_grams"),
        )
        total += order_item.quantity * order_item.unit_price

    order.total_amount = total
    order.save(update_fields=["total_amount"])

    if note:
        OrderNote.objects.create(organization_id=organization_id, order=order, kind="note", body=note)

    publish_event(
        "order.created",
        {
            "organization_id": str(organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "total_amount": str(order.total_amount),
        },
    )
    return order


MANUAL_ORDER_SUFFIX = "M"


def manual_order_placeholder():
    """A unique stand-in order number until the order has its OMS Order ID
    (assign_manual_order_number) - never left on an order."""
    import uuid

    return f"TMP-{uuid.uuid4().hex[:20]}"


def assign_manual_order_number(order):
    """A manual order not created on Shopify is numbered by its OMS Order
    ID plus M (OMS ID 15420 -> "15420M") - can never collide with a Shopify
    number, unlike "the store's next number" did (#12790)."""
    order.refresh_from_db(fields=["supabase_order_no"])
    order.order_number = f"{order.supabase_order_no}{MANUAL_ORDER_SUFFIX}"
    Order.all_objects.filter(pk=order.pk).update(order_number=order.order_number)
    return order


# Not real stores - what manual orders used to be saved under.
_NOT_A_STORE = {"manual"}


def store_options(organization_ids):
    """[{store_id, store_name, organization_id, organization_name,
    organization_code}] - the stores (oms.Store, by shop name) of these
    organizations, for the Manual Order form. "Manual" isn't a store; an
    organization with no store yet is offered under its Shopify store name,
    else its own name (store_id None until its first order)."""
    from core.models import Organization
    from integrations.models import ShopifyConnection

    from .models import Store

    orgs = {
        str(o.id): o
        for o in Organization.objects.filter(id__in=[i for i in organization_ids if i], is_platform=False)
    }
    shop_names = dict(
        ShopifyConnection.all_objects.filter(organization_id__in=list(orgs), is_connected=True)
        .exclude(shop_name="")
        .values_list("organization_id", "shop_name")
    )
    by_org = {}
    for store in Store.all_objects.filter(organization_id__in=list(orgs)).order_by("store_id"):
        if store.name.strip().lower() in _NOT_A_STORE:
            continue
        by_org.setdefault(str(store.organization_id), []).append((store.store_id, store.name))
    options = []
    for org_id, org in orgs.items():
        stores = by_org.get(org_id) or [(None, shop_names.get(org.id) or org.name)]
        for store_id, name in stores:
            options.append({
                "store_id": store_id,
                "store_name": name,
                "organization_id": org_id,
                "organization_name": org.name,
                "organization_code": org.store_code,
            })
    options.sort(key=lambda o: (o["store_name"].lower(), o["organization_name"].lower()))
    return options


def product_lookup(organization_id, q, *, limit=20):
    """[{product_name, sku}] of one store matching `q` by name or SKU -
    its WMS inventory first, then products on its past orders - for the
    Manual Order form's name <-> SKU fill. Exact SKU matches come first."""
    from django.db.models import Q

    from wms.models import StockItem

    q = (q or "").strip()
    if not organization_id or not q:
        return []
    seen, results = set(), []

    def add(name, sku):
        name, sku = (name or "").strip(), (sku or "").strip()
        key = (name.lower(), sku.lower())
        if not name or key in seen:
            return
        seen.add(key)
        results.append({"product_name": name, "sku": sku})

    match = Q(product_name__icontains=q) | Q(sku__icontains=q)
    for name, sku in (
        StockItem.all_objects.filter(match, organization_id=organization_id)
        .values_list("product_name", "sku").order_by("product_name")[:limit]
    ):
        add(name, sku)
    if len(results) < limit:
        for name, sku in (
            OrderItem.all_objects.filter(
                Q(product_name__icontains=q) | Q(barcode__icontains=q), organization_id=organization_id
            )
            .exclude(barcode="")
            .values_list("product_name", "barcode").distinct().order_by("product_name")[: limit * 3]
        ):
            add(name, sku)
            if len(results) >= limit:
                break
    results.sort(key=lambda r: (r["sku"].lower() != q.lower(), r["product_name"].lower() != q.lower()))
    return results[:limit]


def next_order_number(organization_id):
    """The number after this store's newest order - "#1176" -> "#1177",
    "PB-0099" -> "PB-0100" - for a manual order on a store that doesn't
    get its numbers from Shopify. Skips any number already taken; "1"
    for a store with no numbered orders yet."""
    newest = (
        Order.all_objects.filter(organization_id=organization_id)
        .order_by("-created_at")
        .values_list("order_number", flat=True)
        .first()
    )
    match = re.match(r"^(.*?)(\d+)$", newest or "")
    prefix, digits = (match.group(1), match.group(2)) if match else ("", "0")
    number = int(digits)
    while True:
        number += 1
        candidate = f"{prefix}{str(number).zfill(len(digits))}"
        if not Order.all_objects.filter(organization_id=organization_id, order_number=candidate).exists():
            return candidate


# --- Status pipeline -------------------------------------------------------
#
# new -> awaiting_assigning (pending_cc / pending_cod are legacy: orders
# already sitting there can still be confirmed, nothing new enters them) ->
# awaiting_approval -> approved -> awaiting_dispatched -> dispatch_issue ->
# dispatched -> delivered -> returned
# (cancelled reachable from any pre-dispatch status)

ALLOWED_TRANSITIONS = {
    # Untouched inbox - CS picks it up straight into Awaiting Assigning
    # (see acknowledge_order). Cancel stays reachable so junk/test orders
    # don't have to be walked through the whole pipeline first.
    # pending_cc/pending_cod stay listed so orders that were already in
    # them keep their way forward (and a stray old transition still works),
    # but acknowledge_order no longer routes anything there.
    # approved: the New tab's "Approved" action - straight to Approved
    # for an order dispatched without a courier booking.
    # city_issue: Approve on an order whose city isn't on the couriers'
    # city list (see acknowledge_order).
    "new": {"awaiting_assigning", "pending_cc", "pending_cod", "city_issue", "approved", "cancelled"},
    "pending_cc": {"awaiting_assigning", "city_issue", "cancelled"},
    "pending_cod": {"awaiting_assigning", "city_issue", "cancelled"},
    "city_issue": {"awaiting_assigning", "cancelled"},
    # booking_pending is reached directly from here when a courier is
    # pushed to Smartlane instead of assigned to a manual courier - a
    # parallel branch alongside the awaiting_approval path, not a
    # replacement.
    # approved: Self Deliver - shipped by the store itself, no booking.
    "awaiting_assigning": {"awaiting_approval", "booking_pending", "approved", "cancelled"},
    "awaiting_approval": {"approved", "awaiting_assigning", "cancelled"},
    "approved": {"awaiting_dispatched", "cancelled"},
    # Advances to ready_to_print once Smartlane's /track (or webhook)
    # reports a real consignment number - see
    # integrations.services.advance_pending_smartlane_bookings.
    # awaiting_assigning is the way back out of a push that silently failed -
    # the order sits in booking_pending for a consignment the courier never
    # actually created, and without this it is stuck there forever (nothing
    # advances it, and cancelling is terminal). Only reachable through
    # abandon_smartlane_booking, which verifies with Smartlane first.
    "booking_pending": {"ready_to_print", "awaiting_assigning", "cancelled"},
    # An order stays here - visibly "Ready to Print" - through as many
    # airway-bill downloads as needed. Generating its load sheet hands the
    # parcel to the courier, which moves it on to Awaiting Dispatched (see
    # mark_handed_over). Ready to Pick is an explicit manual action
    # (mark_ready_to_pick), and a real dispatch (courier pickup, or the
    # manual Dispatch action) moves it straight to Dispatched.
    "ready_to_print": {"ready_to_pick", "awaiting_dispatched", "dispatched", "cancelled"},
    "ready_to_pick": {"awaiting_dispatched", "dispatched", "cancelled"},
    "awaiting_dispatched": {"dispatched", "dispatch_issue", "cancelled"},
    "dispatch_issue": {"awaiting_dispatched", "cancelled"},
    # out_for_delivery/attempt are Smartlane-reported sub-stages of
    # "dispatched" - only ever reached via apply_smartlane_status, never a
    # manual action. attempt loops back to out_for_delivery/dispatched
    # because a failed attempt is normally retried, not an immediate return.
    "dispatched": {"out_for_delivery", "attempt", "delivered", "returned"},
    "out_for_delivery": {"attempt", "delivered", "returned"},
    "attempt": {"out_for_delivery", "dispatched", "delivered", "returned"},
    "delivered": {"returned"},
    "cancelled": set(),
    "returned": set(),
}


# The Orders page's cards, each the statuses it lists. Every status is in
# exactly one, so an order never shows under two cards - except that an
# out-for-delivery order the courier is bringing back (return_in_progress_
# at) moves from Dispatched/Undelivered to Return in Transit, which has no
# status of its own (see workflow_card / card_queryset). "all" is every
# order.
WORKFLOW_CARD_STATUSES = {
    "awaiting_confirmation": {"new", "pending_cc", "pending_cod", "city_issue", "awaiting_approval"},
    "approved": {"awaiting_assigning", "approved"},
    "assigning_courier": {
        "booking_pending", "ready_to_print", "ready_to_pick", "awaiting_dispatched", "dispatch_issue",
    },
    "dispatched": {"dispatched", "out_for_delivery"},
    "undelivered": {"attempt"},
    "delivered": {"delivered"},
    "returned": {"returned"},
    "cancelled": {"cancelled"},
}
# Out with the courier - where a return can be under way before the order
# is Returned.
RETURNABLE_STATUSES = {"dispatched", "out_for_delivery", "attempt"}
WORKFLOW_CARDS = [
    "awaiting_confirmation", "approved", "assigning_courier", "dispatched", "undelivered",
    "delivered", "return_in_transit", "returned", "cancelled",
]


class InvalidTransition(Exception):
    pass


class SmartlaneBookingError(Exception):
    pass


def _transition(order, to_status, *, actor_user_id=None, note="", extra_fields=None):
    allowed = ALLOWED_TRANSITIONS.get(order.status, set())
    if to_status not in allowed:
        logger.warning(
            "order %s transition REJECTED %s -> %s (allowed from here: %s)",
            order.order_number, order.status, to_status, sorted(allowed) or "nothing",
        )
        raise InvalidTransition(
            f"Cannot move order {order.order_number} from {order.status!r} to {to_status!r}"
        )
    return _apply_transition(
        order, to_status, actor_user_id=actor_user_id, note=note, extra_fields=extra_fields
    )


def _force_transition(order, to_status, *, actor_user_id=None, note="", extra_fields=None):
    """Same bookkeeping as _transition, deliberately WITHOUT checking
    ALLOWED_TRANSITIONS. Reserved for integrations.services.absorb_smartlane_booking
    (via absorb_smartlane_booking below) and its PostEx/BarqRaftar
    counterpart absorb_courier_booking - the only places allowed to jump an
    order straight to Booking Pending from wherever it's sitting locally,
    because the courier has already proven the booking is real (it was made
    directly on their portal, outside this app's own approve/assign/push
    pipeline) - and for set_outcome_by_hand, staff marking a New order they
    handled outside OMS straight to its outcome. Every other call site must
    keep going through _transition."""
    logger.warning(
        "order %s FORCED transition %s -> %s (bypassing ALLOWED_TRANSITIONS)",
        order.order_number, order.status, to_status,
    )
    return _apply_transition(
        order, to_status, actor_user_id=actor_user_id, note=note, extra_fields=extra_fields
    )


def _apply_transition(order, to_status, *, actor_user_id=None, note="", extra_fields=None):
    """All the bookkeeping a transition needs, minus the legality check -
    shared by _transition (checked) and _force_transition (unchecked)."""
    from_status = order.status
    extra_fields = dict(extra_fields or {})
    # Each move into Out for Delivery is one delivery attempt. Counted on the
    # move itself, so a courier repeating the same status (poll + webhook)
    # never counts it twice. A parcel going out again isn't on its way back.
    if to_status == "out_for_delivery" and from_status != "out_for_delivery":
        extra_fields.setdefault("delivery_attempts", (order.delivery_attempts or 0) + 1)
        if order.return_in_progress_at:
            extra_fields.setdefault("return_in_progress_at", None)
    # The Approved card's "Cancelled from Assigning Courier" / "Courier
    # Change Failed" only describe an order still sitting there.
    if order.workflow_flag and to_status not in WORKFLOW_CARD_STATUSES["approved"]:
        extra_fields.setdefault("workflow_flag", "")
    order.status = to_status
    update_fields = ["status", "updated_at"]
    for field, value in extra_fields.items():
        setattr(order, field, value)
        update_fields.append(field)
    order.save(update_fields=update_fields)

    OrderStatusEvent.objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=from_status,
        to_status=to_status,
        note=note,
        actor_user_id=actor_user_id,
    )
    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=order.organization_id,
            action="order.status_change",
            summary=(
                f"Order {order.order_number}: {dict(Order.STATUS_CHOICES).get(from_status, from_status)}"
                f" → {dict(Order.STATUS_CHOICES).get(to_status, to_status)}"
            ),
            actor_user_id=actor_user_id,
            entity_type="order",
            entity_id=str(order.id),
            metadata={
                "order_number": order.order_number,
                "from_status": from_status,
                "to_status": to_status,
                "note": note or "",
            },
        )
    except Exception:
        pass
    # Shopify is updated in the background once this commits (it used to
    # hold every booking up by ~8s) - integrations.shopify_push_queue. A
    # push Shopify refuses is still logged and lands in the audit log.
    try:
        from integrations.shopify_push_queue import queue_order_push

        queue_order_push(order)
    except Exception:
        logger.exception("Couldn't queue the Shopify push for order %s", order.order_number)
    logger.info(
        "order %s status %s -> %s%s%s",
        order.order_number, from_status, to_status,
        f" (actor {actor_user_id})" if actor_user_id else "",
        f" fields={sorted(extra_fields)}" if extra_fields else "",
    )
    publish_event(
        "order.status_changed",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "from_status": from_status,
            "to_status": to_status,
        },
    )
    return order


def acknowledge_order(order, *, actor_user_id=None):
    """New -> Awaiting Assigning: the Awaiting Confirmation card's Approve,
    which puts the order in the Approved card, ready for a courier. (This
    used to stop in Pending CC/COD first, needing a separate Confirm - that
    step is gone.) Same checks as approve_order - only a correct order is
    approved. An order whose only problem is its city goes to City Issue
    instead, to be fixed there (resolve_city_issue) and then approved."""
    from .approval_checks import approval_problems, city_problem

    problems = approval_problems(order, include_city=False)
    if problems:
        raise InvalidTransition("Can't approve - " + "; ".join(problems))
    problem = city_problem(order.city)
    if problem:
        if order.status == "city_issue":
            raise InvalidTransition(f"Can't approve - {problem}")
        return _transition(order, "city_issue", actor_user_id=actor_user_id, note=problem)
    return _transition(order, "awaiting_assigning", actor_user_id=actor_user_id)


def confirm_order(order, *, city_ok=True, actor_user_id=None):
    to_status = "awaiting_assigning" if city_ok else "city_issue"
    return _transition(order, to_status, actor_user_id=actor_user_id)


def resolve_city_issue(order, *, new_city, actor_user_id=None):
    """City Issue -> Awaiting Assigning (the Approved card), with the city
    corrected - only to a city on the couriers' list, and only if the rest
    of the order passes the approval checks too."""
    from .approval_checks import approval_problems, city_key, city_problem
    from .models import City

    new_city = " ".join((new_city or "").split())
    problem = city_problem(new_city)
    if problem:
        raise InvalidTransition(f"Can't approve - {problem}")
    problems = approval_problems(order, include_city=False)
    if problems:
        raise InvalidTransition("Can't approve - " + "; ".join(problems))
    # Saved as the list spells it ("lahore" -> "Lahore").
    listed = City.objects.filter(name_key=city_key(new_city)).values_list("name", flat=True).first()
    return _transition(
        order,
        "awaiting_assigning",
        actor_user_id=actor_user_id,
        extra_fields={"city": listed or new_city},
    )


def assign_courier(order, *, courier_id, actor_user_id=None):
    # Courier rows are per-org (see Courier's unique-together) - this only
    # ever matters when the picker could possibly list another store's
    # courier alongside this order's own, i.e. a super admin's Dispatch
    # Hub (several stores' Courier rows all in one dropdown). A plain
    # single-store request can't trigger this: its own courier list never
    # contains another org's id to begin with.
    try:
        courier = Courier.all_objects.get(id=courier_id)
    except Courier.DoesNotExist as exc:
        raise InvalidTransition(f"Courier {courier_id} not found") from exc
    if str(courier.organization_id) != str(order.organization_id):
        raise InvalidTransition(
            f"Courier {courier.name!r} belongs to a different store than order "
            f"{order.order_number} - pick that store's own courier instead."
        )
    return _transition(
        order,
        "awaiting_approval",
        actor_user_id=actor_user_id,
        extra_fields={"courier_id": courier_id},
    )


# Real courier networks staff book with directly, outside Smartlane's own
# auto-routing - Smartlane's booking API has no field to request one of
# these by name (it decides the carrier itself), so these are plain
# manual Courier rows: picking one is the existing manual assign_courier
# flow, not a Smartlane API call.
DEFAULT_COURIER_NAMES = [
    "Trax", "TCS", "Leopards", "MNP", "Lama", "DEX", "Fastex", "Qwqer", "Tez",
]


def ensure_default_couriers(organization_id):
    """Seeds any of DEFAULT_COURIER_NAMES the org doesn't already have.
    Idempotent and cheap - called from CourierViewSet.list() so every org
    (existing or newly provisioned) ends up with them without a one-off
    migration or management command to run."""
    existing = set(
        Courier.objects.filter(
            organization_id=organization_id, name__in=DEFAULT_COURIER_NAMES
        ).values_list("name", flat=True)
    )
    missing = [name for name in DEFAULT_COURIER_NAMES if name not in existing]
    if missing:
        # ignore_conflicts guards two concurrent requests both seeing the
        # same gap and racing to fill it - the unique (organization, name)
        # constraint would otherwise turn that into a 500.
        Courier.objects.bulk_create(
            [
                Courier(organization_id=organization_id, name=name, is_active=True)
                for name in missing
            ],
            ignore_conflicts=True,
        )


def approve_order(order, *, actor_user_id=None):
    """Only a fully correct order reaches Approved - name, an 11-digit
    phone, an address, a city on the city list, and no receivable left
    on a prepaid order (oms.approval_checks). Anything wrong keeps it where
    it is, with every problem listed."""
    from .approval_checks import approval_problems

    problems = approval_problems(order)
    if problems:
        raise InvalidTransition("Can't approve - " + "; ".join(problems))
    return _transition(order, "approved", actor_user_id=actor_user_id)


def self_deliver(order, *, actor_user_id=None):
    """The Approved card's Self Deliver: the store ships it itself - no
    courier booking. Approved (Awaiting Courier) -> Self Delivered (plain
    Approved)."""
    if order.status != "awaiting_assigning":
        raise InvalidTransition("Only orders awaiting a courier can be self delivered.")
    return _transition(order, "approved", actor_user_id=actor_user_id, note="Self Deliver")


def queue_for_dispatch(order, *, actor_user_id=None):
    return _transition(order, "awaiting_dispatched", actor_user_id=actor_user_id)


def mark_dispatch_issue(order, *, note="", actor_user_id=None):
    return _transition(
        order,
        "dispatch_issue",
        actor_user_id=actor_user_id,
        note=note,
        extra_fields={"issue_note": note},
    )


def set_order_tag(order, *, tag, actor_user_id=None):
    """Update Tag: the order's own free-form tag (Order.tag - the orders
    table's Tag column). The status doesn't change; the change is in the
    order log."""
    tag = (tag or "").strip()[:100]
    if tag == order.tag:
        return order
    old = order.tag
    order.tag = tag
    order.save(update_fields=["tag", "updated_at"])
    OrderStatusEvent.objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=order.status,
        to_status=order.status,
        note=f"Tag changed from {old or '(none)'} to {tag or '(none)'}",
        actor_user_id=actor_user_id,
    )
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "tag",
        },
    )
    return order


# The day an order "is on" for date filters and the Dashboard - Pakistan's,
# not the server's UTC, so an order placed at 2 AM is today's, not
# yesterday's (UTC is 5 hours behind).
BUSINESS_TZ = ZoneInfo("Asia/Karachi")

REVERT_NOTE_PREFIX = "Reverted to "

# Before a courier booking exists - where Revert is offered. (Same set as
# DISPATCH_REQUESTABLE_STATUSES further down, which it would be a forward
# reference to here.)
_PRE_BOOKING_STATUSES = {
    "new", "pending_cc", "pending_cod", "city_issue", "awaiting_assigning",
    "awaiting_approval", "approved",
}
# Statuses before a courier is assigned at all - reverting into one of
# these drops a manually assigned (not yet booked) courier too.
_BEFORE_COURIER_STATUSES = {"new", "pending_cc", "pending_cod", "city_issue", "awaiting_assigning"}


def previous_status(order):
    """The status `order` came from into its current one, for Revert - or
    None when there's nothing to go back to (booked already, or no earlier
    pre-booking status on record). Earlier reverts are skipped, so reverting
    twice walks two steps back instead of undoing the first revert."""
    if order.status not in _PRE_BOOKING_STATUSES or order.tracking_number:
        return None
    events = OrderStatusEvent.all_objects.filter(
        order_id=order.id, to_status=order.status
    ).exclude(note__startswith=REVERT_NOTE_PREFIX).order_by("-created_at")
    for event in events[:5]:
        if event.from_status in _PRE_BOOKING_STATUSES and event.from_status != order.status:
            return event.from_status
    return None


def revert_to_previous_status(order, *, actor_user_id=None):
    """Moves an order that isn't booked yet back to the status it came
    from (see previous_status)."""
    target = previous_status(order)
    if not target:
        raise InvalidTransition(
            f"Order {order.order_number} has no earlier status to revert to."
        )
    label = dict(Order.STATUS_CHOICES).get(target, target)
    extra = {"courier_id": None} if target in _BEFORE_COURIER_STATUSES and order.courier_id else None
    return _force_transition(
        order, target, actor_user_id=actor_user_id, note=f"{REVERT_NOTE_PREFIX}{label}", extra_fields=extra
    )


SHIPPER_ADVICES = ("Reattempt", "Return")


def _active_shipment(model, order):
    """The order's live booking row on one courier, or None. all_objects +
    an explicit store filter, so it works the same inside the Dispatch Hub."""
    return (
        model.all_objects.filter(organization_id=order.organization_id, order=order, is_active=True)
        .exclude(tracking_number="")
        .order_by("-id")
        .first()
    )


def _courier_refused(courier, exc):
    return InvalidTransition(f"{courier} didn't accept the shipper advice: {exc}")


def send_shipper_advice_to_courier(order, *, advice, remarks):
    """Sends Reattempt / Return to the courier the order is booked with,
    through the account it was booked on (the store's own, or FynkTech's for
    a Dispatch Hub booking). Returns the courier's name when it was sent, or
    "" for an order with no courier API booking (manual couriers, sheet
    imports) - those keep the advice in OMS only. Raises InvalidTransition
    with the courier's own message when it refuses, so nothing is saved
    locally that the courier never got."""
    courier_name = (order.courier.name or "").strip() if order.courier_id else ""
    key = courier_name.lower()
    # Remarks are required by PostEx and Leopards; the advice itself is a
    # fine default when the user left them blank.
    remarks = remarks or advice

    if key == "postex":
        from integrations.postex import client as postex_client
        from integrations.postex import services as postex_services
        from integrations.postex.exceptions import PostExAPIError
        from integrations.postex.models import PostExShipment

        shipment = _active_shipment(PostExShipment, order)
        if not shipment:
            return ""
        connection = postex_services.connection_for_order(order)
        if not connection:
            raise InvalidTransition("PostEx isn't connected - can't send the shipper advice.")
        status_id = (
            postex_client.SHIPPER_ADVICE_REATTEMPT if advice == "Reattempt"
            else postex_client.SHIPPER_ADVICE_RETURN
        )
        try:
            postex_client.save_shipper_advice(
                connection.api_token, shipment.tracking_number, status_id=status_id, remarks=remarks[:500],
            )
        except PostExAPIError as exc:
            raise _courier_refused("PostEx", exc) from exc
        return "PostEx"

    if key == "barqraftar":
        from integrations.barqraftar import client as barq_client
        from integrations.barqraftar import services as barq_services
        from integrations.barqraftar.exceptions import BarqRaftarAPIError
        from integrations.barqraftar.models import BarqRaftarShipment

        shipment = _active_shipment(BarqRaftarShipment, order)
        if not shipment:
            return ""
        connection = barq_services.connection_for_order(order)
        if not connection:
            raise InvalidTransition("BarqRaftar isn't connected - can't send the shipper advice.")
        reattempt = advice == "Reattempt"
        try:
            result = barq_client.add_shipper_advice(
                connection.api_key, connection.api_secret,
                tracking_number=shipment.tracking_number,
                shipper_advice="re_attempt" if reattempt else "return",
                re_attempt_reason="same_address" if reattempt else None,
                re_attempt_reason_text=remarks[:255] if reattempt else None,
            )
        except BarqRaftarAPIError as exc:
            raise _courier_refused("BarqRaftar", exc) from exc
        # Refusals can come back as HTTP 200 with success: false.
        if isinstance(result, dict) and result.get("success") is False:
            raise _courier_refused("BarqRaftar", result.get("message") or result.get("error") or "refused")
        return "BarqRaftar"

    if key == "leopards":
        from integrations.leopards import client as leopards_client
        from integrations.leopards import services as leopards_services
        from integrations.leopards.exceptions import LeopardsAPIError
        from integrations.leopards.models import LeopardsShipment

        # "Leopards" is also every store's manual courier - only a real API
        # booking (a LeopardsShipment row) goes to Leopards.
        shipment = _active_shipment(LeopardsShipment, order)
        if not shipment:
            return ""
        connection = leopards_services.connection_for_order(order)
        if not connection:
            raise InvalidTransition("Leopards isn't connected - can't send the shipper advice.")
        try:
            rows = leopards_client.shipper_advice_list(connection, shipment.tracking_number)
            request_row = next((r for r in rows if isinstance(r, dict) and r.get("id")), None)
            if request_row is None:
                raise InvalidTransition(
                    "Leopards hasn't asked for shipper advice on this parcel yet - it only accepts "
                    "advice once it opens a request for an undelivered parcel."
                )
            leopards_client.update_shipper_advice(
                connection, advice_id=request_row["id"], cn_number=shipment.tracking_number,
                status="RA" if advice == "Reattempt" else "RT", remarks=remarks[:500],
            )
        except LeopardsAPIError as exc:
            raise _courier_refused("Leopards", exc) from exc
        return "Leopards"

    if courier_name in _smartlane_courier_names():
        from integrations import smartlane_client
        from integrations.models import SmartlaneConnection, SmartlaneShipment

        shipment = SmartlaneShipment.all_objects.filter(order=order).first()
        consignment = (shipment.consignment_number if shipment else "") or order.tracking_number
        if not consignment:
            return ""
        connection = SmartlaneConnection.for_order(order)
        if not connection:
            raise InvalidTransition(f"{courier_name} isn't connected - can't send the shipper advice.")
        try:
            smartlane_client.update_shipper_advice(
                connection.api_key,
                consignment_number=consignment,
                store_order_id=SmartlaneConnection.reference_for(order),
                courier=(shipment.carrier if shipment else "") or "",
                reason=(shipment.advice_reason if shipment else "") or remarks,
                remarks=remarks,
                action=advice,
            )
        except smartlane_client.SmartlaneAPIError as exc:
            raise _courier_refused(courier_name, exc) from exc
        return courier_name

    return ""


def set_shipper_advice(order, *, advice, remarks="", actor_user_id=None):
    """Undelivered's Shipper Advice: what the store wants the courier to do
    after a failed delivery - Reattempt or Return - with remarks (a new
    time, a corrected address, ...). Sent to the courier's portal first
    (send_shipper_advice_to_courier) - if the courier refuses, nothing is
    saved. Then saved on the order and in its log; the status doesn't
    change."""
    advice = (advice or "").strip()
    remarks = (remarks or "").strip()[:255]
    if advice not in SHIPPER_ADVICES:
        raise InvalidTransition("Pick Reattempt or Return.")
    # The card, not just the status - a failed attempt already on its way
    # back sits in Return in Transit instead.
    if workflow_card(order) != "undelivered":
        raise InvalidTransition(
            f"Order {order.order_number} isn't in Undelivered - Shipper Advice is only for "
            "Undelivered orders."
        )
    sent_to = send_shipper_advice_to_courier(order, advice=advice, remarks=remarks)
    order.shipper_advice = advice
    order.shipper_advice_remarks = remarks
    order.shipper_advice_at = timezone.now()
    order.save(update_fields=["shipper_advice", "shipper_advice_remarks", "shipper_advice_at", "updated_at"])
    OrderStatusEvent.objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=order.status,
        to_status=order.status,
        note=f"Shipper advice: {advice}" + (f" - {remarks}" if remarks else "")
        + (f" (sent to {sent_to})" if sent_to else " (saved in OMS only - no courier booking to send it to)"),
        actor_user_id=actor_user_id,
    )
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "shipper_advice",
        },
    )
    return order


def revert_to_awaiting_confirmation(order, *, tag, actor_user_id=None):
    """The Approved card's Revert: back to New (Awaiting Confirmation) with
    a tag saying why, to be checked and approved again. Only before a
    courier booking - nothing is booked or taken from stock in this card."""
    tag = (tag or "").strip()[:100]
    if not tag:
        raise InvalidTransition("Pick a tag for the revert.")
    if order.status not in WORKFLOW_CARD_STATUSES["approved"]:
        raise InvalidTransition(
            f"Order {order.order_number} is {order.get_status_display()} - only Approved orders "
            "can go back to Awaiting Confirmation."
        )
    extra = {"tag": tag}
    if order.courier_id:
        extra["courier_id"] = None
    return _force_transition(
        order, "new", actor_user_id=actor_user_id,
        note=f"{REVERT_NOTE_PREFIX}Awaiting Confirmation - tag: {tag}", extra_fields=extra,
    )


def retry_dispatch(order, *, actor_user_id=None):
    return _transition(order, "awaiting_dispatched", actor_user_id=actor_user_id)


def mark_delivered(order, *, actor_user_id=None):
    # Manual only in v1 - no courier delivery webhook/API integration exists.
    return _transition(
        order, "delivered", actor_user_id=actor_user_id, extra_fields={"delivered_at": timezone.now()}
    )


def _release_courier_booking(order, *, actor_user_id=None, propagate_to_courier=True,
                             note="Order cancelled by Smartlane/staff", strict=False):
    """Undoes the courier side of a booking: asks the courier to cancel it
    (propagate_to_courier - off when the courier itself reported the
    cancel), puts the stock the booking consumed back, and deactivates the
    courier's shipment row. Shared by cancel_order, unbook_from_assigning
    and unbook_cancelled_by_courier. Does nothing for an order with no
    courier.

    Returns a warning when Smartlane didn't confirm its cancel (that call is
    best-effort), else "". strict raises SmartlaneBookingError instead - for
    Change Courier / Edit Order, where the order is about to be booked again
    and a booking Smartlane still holds would leave two live consignments.
    """
    warning = ""
    # Smartlane-booked orders (Booking Pending / Ready to Print / Ready to
    # Pick - the only statuses cancel is even reachable from once Smartlane
    # is involved, per ALLOWED_TRANSITIONS) have a live consignment on
    # Smartlane's side that a purely-local cancel would leave dangling -
    # the courier would still show up expecting to collect it. Best-effort:
    # a Smartlane-side failure (already picked up, API hiccup) must not
    # block the local cancellation, which is the actually-authoritative one.
    # "Smartlane" or "OMS Courier" - the org's own account or the platform's
    # (see SmartlaneConnection.COURIER_NAMES); for_order picks the one the
    # order was booked with.
    if order.courier_id and order.courier.name in _smartlane_courier_names():
        from wms import services as wms_services

        if propagate_to_courier:
            try:
                from integrations import smartlane_client
                from integrations.models import SmartlaneConnection

                connection = SmartlaneConnection.for_order(order)
                smartlane_client.cancel_consignment(
                    connection.api_key, SmartlaneConnection.reference_for(order)
                )
            except Exception as exc:
                if strict:
                    raise SmartlaneBookingError(
                        f"Smartlane didn't cancel the booking for {order.order_number}: {exc}"
                    ) from exc
                warning = f"Smartlane didn't confirm the booking cancel: {exc}"[:200]
                logger.warning("order %s: %s", order.order_number, warning)
        # consume_for_order only ever runs for a Smartlane courier (push_
        # order_to_smartlane/absorb_smartlane_booking, both set that courier
        # in the same breath as consuming), so this is exactly
        # the population that has stock to put back. Idempotent per order
        # (release_order_stock checks for its own prior reversal), so this
        # is safe even if abandon_smartlane_booking already released it.
        wms_services.release_order_stock(
            order, actor_user_id=actor_user_id, note=note
        )
    # Additive, BarqRaftar-only branch (integrations/barqraftar/) - kept
    # entirely separate from the Smartlane branch above, an `elif` so the
    # two can never both run for the same order. Gated on the courier name
    # FIRST (cheap, no import, no query against a table that may not exist
    # yet if this deploy hasn't run the BarqRaftar migration) before ever
    # touching integrations.barqraftar.
    #
    # propagate_to_courier=False is used by
    # integrations.barqraftar.services.apply_barqraftar_status when
    # BarqRaftar itself already reported the cancel (status 99) - calling
    # their API again there would be pointless and could itself fail.
    # BULK_ACTIONS["cancel"] (oms/views.py) does not pass this, so a
    # staff-initiated cancel always defaults to True: unlike the Smartlane
    # branch's best-effort /cancel call, BarqRaftar's API is asked FIRST
    # and can refuse (parcel already picked up) - see
    # integrations.barqraftar.services.cancel_on_barqraftar, whose
    # BarqRaftarBookingError is left to propagate so the local cancel does
    # not happen underneath a courier that is still actually carrying it.
    elif order.courier_id and (order.courier.name or "").strip().lower() == "barqraftar":
        from integrations.barqraftar import services as barqraftar_services

        if propagate_to_courier:
            barqraftar_services.cancel_on_barqraftar(order)
        barqraftar_services.release_shipment_stock_and_deactivate(
            order, actor_user_id=actor_user_id
        )
    # Additive, PostEx-only branch (integrations/postex/) - same shape and
    # reasoning as the BarqRaftar branch just above: gated on the courier
    # name first, PostEx is asked FIRST and its PostExBookingError (parcel
    # already with PostEx) propagates so the local cancel doesn't happen
    # under a courier that is still carrying it. propagate_to_courier=False
    # is used when PostEx itself reported the cancel.
    elif order.courier_id and (order.courier.name or "").strip().lower() == "postex":
        from integrations.postex import services as postex_services

        if propagate_to_courier:
            postex_services.cancel_on_postex(order)
        postex_services.release_shipment_stock_and_deactivate(order, actor_user_id=actor_user_id)
    # Additive, Leopards-only branch (integrations/leopards/) - same shape as
    # the PostEx branch above. The name "Leopards" is NOT proof of a Leopards
    # booking: every org has a manual courier of that name, and sheet
    # imports / Shopify fulfillments attach orders to it. Both calls below
    # therefore work from LeopardsShipment rows and do nothing for an order
    # that has none (no Leopards API call, no stock put back that was never
    # taken). Needs the leopards_integrations tables (migration
    # integrations.0026_leopards / leopards/sql/0026_leopards.sql).
    elif order.courier_id and (order.courier.name or "").strip().lower() == "leopards":
        from integrations.leopards import services as leopards_services

        if propagate_to_courier:
            leopards_services.cancel_on_leopards(order)
        leopards_services.release_shipment_stock_and_deactivate(order, actor_user_id=actor_user_id)
    return warning


def cancel_order(order, *, reason="", actor_user_id=None, propagate_to_courier=True):
    warning = _release_courier_booking(
        order, actor_user_id=actor_user_id, propagate_to_courier=propagate_to_courier
    )
    # A Smartlane cancel that wasn't confirmed stays on the order's log, so
    # nobody takes the booking for cancelled on Smartlane's side.
    note = f"{reason} ({warning})" if warning else reason
    return _transition(
        order,
        "cancelled",
        actor_user_id=actor_user_id,
        note=note,
        extra_fields={"cancel_reason": (reason or "")[:255]},
    )


# Why an order came back to Approved with its booking cancelled - see
# Order.workflow_flag.
FLAG_CANCELLED_FROM_ASSIGNING = "cancelled_from_assigning"
FLAG_COURIER_CHANGE_FAILED = "courier_change_failed"
# Auto Book found the order's city on neither BarqRaftar's nor PostEx's
# list (see auto_book_routes).
FLAG_NO_CITY_MATCH = "no_city_match"
# A booking was refused because the warehouse doesn't hold enough of the
# order's items - it stays in Approved until there is (see
# flag_stock_shortages).
FLAG_NO_STOCK = "no_stock"

# Everything a booking leaves on the order - cleared when the booking is
# undone, so no old courier or tracking number lingers as the active one.
_BOOKING_FIELDS_CLEARED = {
    "courier_id": None,
    "tracking_number": "",
    "platform_reference": "",
    "courier_status": "",
    "booked_at": None,
    "dispatched_at": None,
    "hub_dispatched_at": None,
    "packed_at": None,
    "packed_by_email": "",
}


def auto_book_routes(organization_id, order_ids, *, via_platform=False):
    """Auto Book's routing: an order whose city is spelled exactly as one
    of BarqRaftar's cities goes to BarqRaftar, else exactly as one of
    PostEx's to PostEx (only case, extra spaces and dots are ignored - no
    short forms or aliases). An order on neither list stays where it is,
    tagged No City Matched. Returns (barqraftar_ids, postex_ids,
    unmatched_ids, error) - error instead when either list can't be read,
    so nothing is routed on a guess."""
    from integrations.barqraftar import services as barqraftar_services
    from integrations.barqraftar.models import BarqRaftarConnection
    from integrations.postex import services as postex_services
    from integrations.postex.models import PostExConnection

    from .approval_checks import city_key

    lists = {}
    for name, module, model, read in (
        ("BarqRaftar", barqraftar_services, BarqRaftarConnection, lambda c: [x["name"] for x in barqraftar_services.get_cities(c)]),
        ("PostEx", postex_services, PostExConnection, postex_services.get_cities),
    ):
        connection = (
            module.platform_connection() if via_platform
            else model.objects.filter(organization_id=organization_id, is_connected=True).first()
        )
        if connection is None:
            return [], [], [], f"Connect {name} from the Integrations page first - Auto Book needs its city list."
        try:
            lists[name] = {city_key(c) for c in read(connection)}
        except Exception as exc:
            return [], [], [], f"Could not load {name} cities: {exc}"

    cities = {
        str(oid): city
        for oid, city in Order.objects.filter(
            organization_id=organization_id, id__in=order_ids
        ).values_list("id", "city")
    }
    barqraftar_ids, postex_ids, unmatched_ids = [], [], []
    for order_id in order_ids:
        key = city_key(cities.get(str(order_id), ""))
        if key and key in lists["BarqRaftar"]:
            barqraftar_ids.append(order_id)
        elif key and key in lists["PostEx"]:
            postex_ids.append(order_id)
        else:
            unmatched_ids.append(order_id)
    if unmatched_ids:
        Order.objects.filter(
            organization_id=organization_id, id__in=unmatched_ids, status="awaiting_assigning"
        ).update(workflow_flag=FLAG_NO_CITY_MATCH, updated_at=timezone.now())
    return barqraftar_ids, postex_ids, unmatched_ids, None


def _stock_priority(order):
    """Who gets limited stock first: prepaid before COD, then oldest first
    (FIFO). Internal only - never shown in the UI."""
    prepaid = order.payment_gateway != "cod" or order.payment_status == "paid"
    return (0 if prepaid else 1, order.placed_at or order.created_at)


def allocate_stock(orders, *, strict=False):
    """Shares the warehouse's stock among `orders` (about to be booked) in
    _stock_priority order, each order holding its units so the next one
    only sees what's left - a bulk booking can't promise the same units
    twice, and a prepaid order is never left short for a COD one. Returns
    (fitting orders in priority order, [(order, shortages)]). strict: see
    wms.services.check_order_stock - the Dispatch Hub's bookings."""
    from wms import services as wms_services

    reserved = {}
    fits, short = [], []
    for order in sorted(orders, key=_stock_priority):
        shortages = wms_services.check_order_stock(
            order, reserved=reserved.setdefault(order.organization_id, {}), strict=strict
        )
        if shortages:
            short.append((order, shortages))
        else:
            fits.append(order)
    return fits, short


def flag_stock_shortages(results):
    """Tags the orders a booking refused for stock (error_code
    insufficient_stock) Stock Not Available, so they're told apart in
    Approved. The tag clears once the order is booked (see _transition)."""
    short = [r["order_id"] for r in results if r.get("error_code") == "insufficient_stock"]
    if short:
        rows = Order.objects.filter(id__in=short, status="awaiting_assigning")
        tagged = list(rows.only("id", "organization_id", "order_number"))
        rows.update(workflow_flag=FLAG_NO_STOCK, updated_at=timezone.now())
        # A queryset update, so oms.signals' change log doesn't see it.
        for order in tagged:
            _log_order_change(order, "Tagged Stock Not Available")


def _log_order_change(order, what, *, actor_user_id=None):
    """A Logs-tab row for an order change made with a queryset update,
    which oms.signals' change log can't see."""
    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=order.organization_id,
            action="order.updated",
            summary=f"Order {order.order_number}: {what}",
            actor_user_id=actor_user_id,
            entity_type="order",
            entity_id=str(order.id),
            metadata={"order_number": order.order_number},
        )
    except Exception:
        logger.exception("Failed to log change to order %s", order.order_number)


# A cancelled booking sends the order back to Awaiting Confirmation with
# this tag, and a new store order ID in the database: 1001 -> 1001-1 ->
# 1001-2 ... (the OMS Order ID stays). Screens keep showing 1001
# (Order.original_order_number), and the order log doesn't mention it.
BOOKING_CANCELLED_TAG = "Cancelled from Courier Booking"


def _next_cancel_number(order):
    """The order's next store order ID after a booking cancel: its original
    number plus -1, -2, ... - one past the one it has now, skipping any
    number the store already has."""
    base = order.original_order_number or order.order_number
    n = 1
    match = re.fullmatch(re.escape(base) + r"-(\d+)", order.order_number)
    if order.original_order_number and match:
        n = int(match.group(1)) + 1
    while Order.all_objects.filter(
        organization_id=order.organization_id, order_number=f"{base}-{n}"
    ).exists():
        n += 1
    return f"{base}-{n}"[:50]


def _back_to_confirmation_after_cancel(order, *, actor_user_id, note):
    """The booking is already cancelled: the order goes back to Awaiting
    Confirmation (New), tagged BOOKING_CANCELLED_TAG, under its next store
    order ID - courier, tracking number and booking stamps cleared."""
    original = order.original_order_number or order.order_number
    new_number = _next_cancel_number(order)
    return _force_transition(
        order,
        "new",
        actor_user_id=actor_user_id,
        note=note,
        extra_fields={
            **_BOOKING_FIELDS_CLEARED,
            "workflow_flag": "",
            "tag": BOOKING_CANCELLED_TAG,
            "order_number": new_number,
            "original_order_number": original,
        },
    )


def unbook_for_edit(order, *, actor_user_id=None):
    """Assigning Courier's Edit Order: cancels the booking with its courier
    (strictly - a courier that refuses, e.g. already picked up, leaves the
    order exactly as it was), puts its stock back, and sends the order to
    Awaiting Confirmation to be edited and approved again - see
    _back_to_confirmation_after_cancel."""
    if order.status not in WORKFLOW_CARD_STATUSES["assigning_courier"]:
        raise InvalidTransition(
            f"Order {order.order_number} is {order.get_status_display()} - only orders in "
            "Assigning Courier can have their booking cancelled here."
        )
    old_booking = " ".join(
        part for part in (order.courier.name if order.courier_id else "", order.tracking_number) if part
    )
    with transaction.atomic():
        _release_courier_booking(
            order, actor_user_id=actor_user_id, note="Cancel Booking - booking cancelled", strict=True
        )
        return _back_to_confirmation_after_cancel(
            order, actor_user_id=actor_user_id,
            note=f"Cancel Booking - booking {old_booking or '(none)'} cancelled",
        )


def next_replacement_number(original):
    """A Replacement's store order ID: the original's, plus R - R2, R3 ...
    when that's taken (an order replaced more than once)."""
    base = original.order_number
    n = 1
    while True:
        candidate = f"{base}R{n if n > 1 else ''}"[:50]
        if not Order.all_objects.filter(
            organization_id=original.organization_id, order_number=candidate
        ).exists():
            return candidate
        n += 1


def unbook_from_assigning(order, *, flag, reason, actor_user_id=None):
    """Assigning Courier's Edit Order and Change Courier: cancels the
    order's booking with its courier (strictly - a courier that refuses,
    e.g. the parcel is already picked up, leaves the order exactly as it
    was), puts its stock back, and returns it to Approved (awaiting_
    assigning) with no courier or tracking number and `flag` set. The old
    courier and tracking number stay on its log."""
    if order.status not in WORKFLOW_CARD_STATUSES["assigning_courier"]:
        raise InvalidTransition(
            f"Order {order.order_number} is {order.get_status_display()} - only orders in "
            "Assigning Courier can have their booking cancelled here."
        )
    old_booking = " ".join(
        part for part in (order.courier.name if order.courier_id else "", order.tracking_number) if part
    )
    with transaction.atomic():
        _release_courier_booking(
            order, actor_user_id=actor_user_id, note=f"{reason} - booking cancelled", strict=True
        )
        return _force_transition(
            order,
            "awaiting_assigning",
            actor_user_id=actor_user_id,
            note=f"{reason} - booking {old_booking or '(none)'} cancelled",
            extra_fields={**_BOOKING_FIELDS_CLEARED, "workflow_flag": flag},
        )


# Statuses an order can be in when its courier cancels the booking - booked,
# not yet with the customer or back.
_UNBOOKABLE_STATUSES = {
    "booking_pending", "ready_to_print", "ready_to_pick", "awaiting_dispatched",
    "dispatch_issue", "dispatched", "out_for_delivery", "attempt",
}


def _courier_key(name):
    """A courier name reduced to letters - "Post Ex", "POSTEX" -> "postex"."""
    return re.sub(r"[^a-z]", "", (name or "").lower())


def _booked_with(order, courier_label):
    """Whether the order's current booking is with `courier_label` (or it
    has no courier at all - nothing else to protect). Smartlane covers both
    of its accounts ("Smartlane" / "OMS Courier")."""
    if not order.courier_id:
        return True
    name = order.courier.name
    if _courier_key(courier_label) == "smartlane":
        return name in _smartlane_courier_names()
    return _courier_key(name) == _courier_key(courier_label)


def booking_is_current(order, shipment, *, courier_label):
    """A courier update (poll or webhook) belongs to the order's CURRENT
    booking only if its shipment row is still active - re-read from the
    database, since a poll loads its list first and a Change Courier /
    Cancel Booking can switch it off meanwhile - and the order hasn't moved
    to another booking (a different tracking number with another courier).
    Anything else is an old booking's update: it must not touch the order."""
    if not type(shipment).all_objects.filter(pk=shipment.pk, is_active=True).exists():
        return False
    order_tn = (order.tracking_number or "").strip()
    shipment_tn = (shipment.tracking_number or "").strip()
    if order_tn and shipment_tn and order_tn != shipment_tn and not _booked_with(order, courier_label):
        return False
    return True


def note_old_booking_update(order, *, courier_label, tracking_number=""):
    """One line on the order's log (once per old booking) saying an update
    for a booking it no longer has was ignored."""
    from .models import OrderStatusEvent

    note = f"Old {courier_label} booking update ignored"
    if tracking_number:
        note += f" (CN {tracking_number})"
    note = note[:255]
    logger.info("order %s: %s", order.order_number, note)
    if OrderStatusEvent.all_objects.filter(order=order, note=note).exists():
        return
    OrderStatusEvent.all_objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=order.status,
        to_status=order.status,
        note=note,
    )


def unbook_cancelled_by_courier(order, *, courier_label, tracking_number="", actor_user_id=None):
    """The courier cancelled the booking on its own portal: the order itself
    isn't cancelled - only its booking is. The stock goes back, the courier,
    consignment/tracking number and booking stamps are cleared, and the
    order returns to Awaiting Confirmation under a new store order ID
    (_back_to_confirmation_after_cancel). Returns True if
    the order changed; an order already past booking's reach (delivered,
    returned, cancelled) or not booked is left alone.

    Only the booking that was cancelled is undone: an order now booked with
    another courier, or under another tracking number (`tracking_number`,
    the cancelled booking's), is left exactly as it is."""
    if order.status not in _UNBOOKABLE_STATUSES:
        return False
    order_tn = (order.tracking_number or "").strip()
    cancelled_tn = (tracking_number or "").strip()
    if not _booked_with(order, courier_label) or (order_tn and cancelled_tn and order_tn != cancelled_tn):
        note_old_booking_update(order, courier_label=courier_label, tracking_number=cancelled_tn)
        return False
    _release_courier_booking(
        order,
        actor_user_id=actor_user_id,
        propagate_to_courier=False,
        note=f"Booking cancelled on {courier_label}",
    )
    _back_to_confirmation_after_cancel(
        order, actor_user_id=actor_user_id,
        note=f"Booking cancelled on {courier_label} - booking and tracking number removed",
    )
    return True


def mark_returned_by_courier(order, *, reason="", actor_user_id=None):
    """Moves straight to Returned when a courier integration itself reports
    the parcel back, from whichever dispatch sub-stage the order is
    currently sitting in (dispatched/out_for_delivery/attempt/delivered -
    all reach "returned" directly, see ALLOWED_TRANSITIONS). scan_return
    can't be reused for this: it looks the order up by order_number itself
    (this already has the Order instance) and refuses out_for_delivery/
    attempt, both of which a courier status feed reports routinely.
    Additive - used only by integrations.barqraftar.services.
    apply_barqraftar_status; Smartlane's own returned handling
    (integrations/services.py) is unaffected and unchanged. The courier's
    own remark, kept while the parcel was on its way back
    (record_return_reason), stays the return reason over the generic
    `reason`."""
    return _transition(
        order, "returned", actor_user_id=actor_user_id, note=reason,
        extra_fields={
            "returned_at": timezone.now(),
            "return_reason": ((order.return_reason or "").strip() or reason or "")[:255],
        },
    )


# What staff can mark by hand on an order still in New, with the date each
# one stamps - an order handled outside OMS (booked on a courier's own
# portal, or delivered / returned before the store started using OMS), so it
# never went through the pipeline here. Cancelling is cancel_order, already
# a normal step from New.
HAND_SET_OUTCOMES = {
    "dispatched": "dispatched_at",
    "delivered": "delivered_at",
    "returned": "returned_at",
}


def set_outcome_by_hand(order, to_status, *, actor_user_id=None):
    """New -> Dispatched / Delivered / Returned in one step, skipping the
    pipeline in between (_force_transition): the parcel went out without
    OMS, so there's no booking, printing or dispatch scan to walk through.
    No stock is taken - nothing here ever reserved any for it."""
    if to_status not in HAND_SET_OUTCOMES:
        raise InvalidTransition(f"{to_status!r} can't be set by hand.")
    if order.status != "new":
        raise InvalidTransition(
            f"Order {order.order_number} is {order.get_status_display()} - only New orders can "
            "be marked by hand."
        )
    stamp = HAND_SET_OUTCOMES[to_status]
    return _force_transition(
        order,
        to_status,
        actor_user_id=actor_user_id,
        note=f"Marked {dict(Order.STATUS_CHOICES)[to_status]} by hand from New",
        extra_fields={} if getattr(order, stamp) else {stamp: timezone.now()},
    )


def book_with_courier(order, *, courier_id, tracking_number, actor_user_id=None):
    """Generic local bookkeeping for a courier integrated directly rather
    than through Smartlane: courier assignment, the booking_pending
    transition, and stock consumption - exactly the same atomic block
    push_order_to_smartlane runs below, minus the outbound booking call
    (the caller has already made it and already has a real tracking
    number, unlike Smartlane's fire-and-forget /create). Additive - the
    only caller today is integrations.barqraftar.services.book_orders."""
    from wms import services as wms_services

    with transaction.atomic():
        order = _transition(
            order, "booking_pending", actor_user_id=actor_user_id,
            extra_fields={"courier_id": courier_id, "tracking_number": tracking_number},
        )
        # force=True: the caller already resolved the stock-shortage
        # decision before booking with the courier (see book_orders) -
        # re-checking here would raise on exactly the case just approved.
        wms_services.consume_for_order(order, force=True, actor_user_id=actor_user_id)
    return order


def _smartlane_courier_names():
    from integrations.models import SmartlaneConnection

    return set(SmartlaneConnection.COURIER_NAMES.values())


def push_order_to_smartlane(order, *, actor_user_id=None, force=False, account="own", via_platform=False):
    """Submits this order to Smartlane and moves it to Booking Pending -
    the Smartlane-assigned equivalent of the manual Approve/Dispatch path,
    triggered from the "Assign courier" modal when the user picks
    Smartlane or OMS Courier instead of a real Courier row.

    `account` is the SmartlaneConnection kind to book through - "own" (the
    org's own Smartlane) or "oms" (OMS Courier). The order gets that
    account's courier, which is how it's tracked/printed/cancelled through
    the same account afterwards.

    `via_platform` (the Dispatch Hub's bookings, set server-side only - see
    oms/views.py's bulk_action) sends an "own" booking through FynkTech's
    own Smartlane account instead of the store's, under a store-coded
    store_order_id kept on Order.platform_reference - which is how it's
    tracked/printed/cancelled through FynkTech's account afterwards.

    Smartlane's /create call is fire-and-forget: it confirms the booking
    was accepted but does not hand back a consignment number, so this
    cannot go straight to Ready to Print the way it used to with the old
    local-placeholder stub. It parks in Booking Pending until
    integrations.services.advance_pending_smartlane_bookings (polling
    /track) or the webhook reports a real consignment number and moves it
    on to Ready to Print itself.

    Stock is checked *before* the booking is submitted: if the warehouse is
    short and force=False, wms.services.InsufficientStock propagates to the
    caller so the UI can show the shortage and offer to proceed anyway.
    Checking first matters - booking with Smartlane and only then finding
    out we can't fulfil would leave a real consignment we'd have to cancel.
    """
    from integrations import smartlane_client
    from integrations.models import SmartlaneConnection
    from wms import services as wms_services

    # Checked before anything else, including the real API call below - a
    # double-click or retry on an order that's already past Awaiting
    # Assigning must not create a second real Smartlane consignment for
    # the same order. _transition() would also catch this, but only AFTER
    # the outbound call already happened, which is too late.
    logger.info("smartlane push requested for order %s (status=%s, force=%s)",
                order.order_number, order.status, force)

    if order.status != "awaiting_assigning":
        logger.warning("smartlane push refused for %s: status is %s, not awaiting_assigning",
                       order.order_number, order.status)
        raise SmartlaneBookingError(
            f"Order {order.order_number} is {order.get_status_display()}, not Awaiting Assigning."
        )

    # Raises InsufficientStock unless force - deliberately before any
    # outbound Smartlane call.
    shortages = wms_services.check_order_stock(order)
    if shortages and not force:
        logger.warning("smartlane push blocked for %s: short on %s",
                       order.order_number, [s["sku"] for s in shortages])
        raise wms_services.InsufficientStock(shortages)
    if shortages:
        logger.warning("smartlane push proceeding for %s DESPITE shortages on %s (force=True)",
                       order.order_number, [s["sku"] for s in shortages])

    if account not in SmartlaneConnection.COURIER_NAMES:
        raise SmartlaneBookingError(f"Unknown booking account {account!r}.")
    platform_reference = ""
    if via_platform and account == SmartlaneConnection.KIND_OWN:
        from core.platform_service import platform_organization_id, platform_smartlane_reference

        connection = SmartlaneConnection.all_objects.filter(
            organization_id=platform_organization_id(),
            kind=SmartlaneConnection.KIND_OWN,
            is_connected=True,
        ).first()
        if connection is None:
            raise SmartlaneBookingError(
                "Connect FynkTech's Smartlane account on the super admin's OMS Couriers tab first."
            )
        platform_reference = platform_smartlane_reference(order)
    else:
        try:
            connection = SmartlaneConnection.objects.get(
                organization_id=order.organization_id, kind=account, is_connected=True
            )
        except SmartlaneConnection.DoesNotExist:
            logger.error("smartlane push failed for %s: no connected %s SmartlaneConnection for org %s",
                         order.order_number, account, order.organization_id)
            raise SmartlaneBookingError(
                f"Connect {SmartlaneConnection.COURIER_NAMES[account]} from the Integrations page first."
            )

    try:
        smartlane_client.create_booking(
            order, connection.api_key, connection.store_warehouse_code,
            store_order_id=platform_reference or None,
        )
    except smartlane_client.SmartlaneAPIError as exc:
        logger.error("smartlane booking REJECTED for %s: %s", order.order_number, exc)
        raise SmartlaneBookingError(str(exc)) from exc

    courier, _ = Courier.objects.get_or_create(
        organization_id=order.organization_id,
        name=connection.courier_name,
        defaults={"is_active": True},
    )
    with transaction.atomic():
        order = _transition(
            order,
            "booking_pending",
            actor_user_id=actor_user_id,
            # Cleared for a store-account booking, in case an earlier,
            # since-abandoned one went through FynkTech's.
            extra_fields={"courier_id": courier.id, "platform_reference": platform_reference},
        )
        # force=True here because the shortage decision was already made
        # above - re-checking would raise on exactly the case the user just
        # approved.
        wms_services.consume_for_order(order, force=True, actor_user_id=actor_user_id)
    logger.info(
        "smartlane push COMPLETE for %s - now Booking Pending, awaiting a consignment number "
        "from the webhook or the poller", order.order_number,
    )
    return order


def absorb_smartlane_booking(order, *, actor_user_id=None, courier_name="Smartlane"):
    """Lands an order at Booking Pending for a booking Smartlane already
    has, made outside this app entirely (booked directly on Smartlane's own
    portal, e.g. by file import) rather than through push_order_to_smartlane.
    No Smartlane API call happens here - Smartlane already knows about this
    order (that's how the caller found it via integrations.services.
    absorb_untracked_smartlane_order), so calling create_booking would
    double-book it. Mirrors push_order_to_smartlane's booking_pending +
    stock-consumption pair exactly, minus the outbound booking call, via
    _force_transition since the order may be sitting anywhere pre-booking
    (new, pending_cc, awaiting_approval, ...) - not just awaiting_assigning.
    `courier_name` is the reporting account's courier ("Smartlane" or "OMS
    Courier"), see SmartlaneConnection.COURIER_NAMES."""
    from wms import services as wms_services

    # all_objects: the poller has no HTTP tenant context, so
    # Courier.objects is empty and get_or_create inserts a duplicate.
    courier, _ = Courier.all_objects.get_or_create(
        organization_id=order.organization_id, name=courier_name, defaults={"is_active": True}
    )
    with transaction.atomic():
        order = _force_transition(
            order,
            "booking_pending",
            actor_user_id=actor_user_id,
            note="Booked directly on Smartlane's portal - reconciled automatically",
            extra_fields={"courier_id": courier.id},
        )
        wms_services.consume_for_order(order, force=True, actor_user_id=actor_user_id)
    logger.info(
        "smartlane absorb COMPLETE for %s - now Booking Pending (booked outside this app)",
        order.order_number,
    )
    return order


def absorb_courier_booking(order, *, courier_id, tracking_number, note, actor_user_id=None):
    """absorb_smartlane_booking's counterpart for a directly-integrated
    courier (PostEx, BarqRaftar): lands an order at Booking Pending for a
    booking made on that courier's own portal rather than through this app,
    with the tracking number the courier already reported. No courier API
    call - same forced transition + stock consumption pair, so the order
    ends up exactly where book_with_courier would have put it. The caller
    (integrations.postex/barqraftar services' adopt_portal_bookings) has
    already saved the shipment row and advances it from here."""
    from wms import services as wms_services

    with transaction.atomic():
        order = _force_transition(
            order,
            "booking_pending",
            actor_user_id=actor_user_id,
            note=note,
            extra_fields={"courier_id": courier_id, "tracking_number": tracking_number},
        )
        wms_services.consume_for_order(order, force=True, actor_user_id=actor_user_id)
    logger.info("courier absorb COMPLETE for %s - now Booking Pending (%s)", order.order_number, note)
    return order


def abandon_smartlane_booking(order, *, actor_user_id=None):
    """Returns an order stuck in Booking Pending to Awaiting Assigning so it
    can be pushed again, and puts back the stock the failed push consumed.

    Only for pushes that never produced a consignment. Smartlane is asked
    first and this refuses if they DO know the order - reversing the stock
    for a parcel a courier is genuinely carrying would be far worse than
    leaving the order where it is.
    """
    from integrations import smartlane_client
    from integrations.models import SmartlaneConnection
    from wms import services as wms_services

    if order.status != "booking_pending":
        raise InvalidTransition(
            f"Order {order.order_number} is {order.get_status_display()}, not Booking Pending."
        )

    connection = SmartlaneConnection.for_order(order)
    if not connection:
        raise SmartlaneBookingError("Connect Smartlane from the Integrations page first.")

    try:
        rows = smartlane_client.track_consignments(
            connection.api_key, [SmartlaneConnection.reference_for(order)]
        )
    except smartlane_client.SmartlaneAPIError as exc:
        # Refuse rather than guess - if we can't confirm the booking is
        # absent we must not put its stock back.
        logger.error("smartlane abandon check failed for %s: %s", order.order_number, exc)
        raise SmartlaneBookingError(
            f"Could not confirm with Smartlane whether {order.order_number} is booked: {exc}"
        ) from exc

    if rows:
        logger.warning("smartlane abandon refused for %s: Smartlane returned %s row(s)",
                       order.order_number, len(rows))
        raise SmartlaneBookingError(
            f"Smartlane does have a consignment for {order.order_number} - "
            "sync statuses instead of abandoning it."
        )

    released = wms_services.release_order_stock(
        order, actor_user_id=actor_user_id, note="Smartlane booking was never created"
    )
    logger.info("smartlane abandon for %s: released %s stock line(s)",
                order.order_number, len(released))
    return _transition(
        order,
        "awaiting_assigning",
        actor_user_id=actor_user_id,
        note="Smartlane booking was never created - returned for re-push",
        extra_fields={
            "courier_id": None, "tracking_number": "", "platform_reference": "", "courier_status": "",
        },
    )


def advance_booking_confirmed(order, *, actor_user_id=None):
    """Booking Pending -> Ready to Print, once Smartlane has reported a
    real consignment number (via /track polling or the webhook) - see
    integrations.services.poll_smartlane_statuses. Caller is expected to
    have already set/saved order.tracking_number before calling this."""
    return _transition(order, "ready_to_print", actor_user_id=actor_user_id)


def mark_ready_to_pick(order, *, actor_user_id=None):
    # Triggered as a side effect of downloading the loadsheet (see
    # OrderViewSet.loadsheet) rather than a standalone user action - the
    # download itself is the "picked up for warehouse picking" signal.
    return _transition(order, "ready_to_pick", actor_user_id=actor_user_id)


# Booked with a courier but still on our shelf - no load sheet yet.
ON_SHELF_STATUSES = ("ready_to_print", "ready_to_pick")

# The courier's own word (Order.courier_status, the Sub Status) for a
# parcel it has booked but nobody has handed over yet, and for one handed
# over and waiting for the rider. Compared case-insensitively.
QUEUE_COURIER_STATUSES = ("queue", "queued", "unbooked", "pending")
AWAITING_PICKUP_COURIER_STATUSES = ("awaiting pickup", "awaiting_pickup", "booked", "ready")


def _courier_status_in(words):
    condition = Q()
    for word in words:
        condition |= Q(courier_status__iexact=word)
    return condition


def booking_pending_orders(qs):
    """The Booking Pending tab: every order still waiting on its booking
    (status booking_pending), plus those on the shelf that the courier
    still calls queue / Unbooked / Pending - which stay in Ready to Print
    too, until their load sheet is made."""
    return qs.filter(
        Q(status="booking_pending")
        | (Q(status__in=ON_SHELF_STATUSES) & _courier_status_in(QUEUE_COURIER_STATUSES))
    )


def awaiting_dispatch_orders(qs):
    """The Awaiting Dispatched tab: every order whose load sheet is made
    (status awaiting_dispatched), plus those still on the shelf that the
    courier already calls Awaiting Pickup / Booked / ready - which stay in
    Ready to Print too, until their load sheet is made."""
    return qs.filter(
        Q(status="awaiting_dispatched")
        | (Q(status__in=ON_SHELF_STATUSES) & _courier_status_in(AWAITING_PICKUP_COURIER_STATUSES))
    )


# The New tab lists these together - there's no separate Awaiting
# Confirmation (awaiting_approval) tab any more.
NEW_TAB_STATUSES = ["new", "awaiting_approval"]


def workflow_card(order):
    """Which Orders card `order` sits under (WORKFLOW_CARD_STATUSES)."""
    if order.return_in_progress_at and order.status in RETURNABLE_STATUSES:
        return "return_in_transit"
    for card, statuses in WORKFLOW_CARD_STATUSES.items():
        if order.status in statuses:
            return card
    return ""


# Each card's name as the Orders page shows it (frontend statusConfig's
# STATUS_TABS) - the report's Order Status.
WORKFLOW_CARD_LABELS = {
    "awaiting_confirmation": "Awaiting Confirmation",
    "approved": "Approved",
    "assigning_courier": "Assigning Courier",
    "dispatched": "Dispatched",
    "undelivered": "Undelivered",
    "return_in_transit": "Return in Transit",
    "delivered": "Delivered",
    "returned": "Returned",
    "cancelled": "Cancelled",
}


def card_label(order):
    """The order's status as the screens show it - its card's name."""
    return WORKFLOW_CARD_LABELS.get(workflow_card(order)) or order.get_status_display()


def latest_tag(order):
    """The ONE tag the screens show (frontend statusConfig.latestTag /
    OrdersTable.tagText): in Awaiting Confirmation, or when the card has no
    tag of its own, the order's own tag; otherwise the card's tag, with the
    attempt number on a re-attempted parcel."""
    card = workflow_card(order)
    card_tag = workflow_tag(order)
    if order.tag and (card == "awaiting_confirmation" or not card_tag):
        return order.tag
    attempts = order.delivery_attempts or 0
    if card_tag and attempts > 1 and card in ("dispatched", "undelivered"):
        return f"{card_tag} · Attempt {attempts}"
    return card_tag


def card_queryset(qs, card):
    """`qs` narrowed to one card's orders - the database twin of
    workflow_card."""
    in_return = Q(return_in_progress_at__isnull=False, status__in=RETURNABLE_STATUSES)
    if card == "return_in_transit":
        return qs.filter(in_return)
    # The returns desk's Total Returns: on the way back, or back.
    if card == "all_returns":
        return qs.filter(in_return | Q(status="returned"))
    statuses = WORKFLOW_CARD_STATUSES[card]
    qs = qs.filter(status__in=statuses)
    if statuses & RETURNABLE_STATUSES:
        qs = qs.exclude(in_return)
    return qs


def workflow_tag(order):
    """The order's tag on its card: where in that card it is - To Be Packed
    or Packed, In Transit or Out for Delivery, or the courier's own word
    for a failed attempt or a return."""
    card = workflow_card(order)
    status = order.status
    courier_word = (order.courier_status or "").strip()
    if card == "awaiting_confirmation":
        if status == "new":
            return "New"
        if status == "city_issue":
            return "City Issue"
        return "Pending Approval"
    if card == "approved":
        if order.workflow_flag == FLAG_CANCELLED_FROM_ASSIGNING:
            return "Cancelled from Assigning Courier"
        if order.workflow_flag == FLAG_COURIER_CHANGE_FAILED:
            return "Courier Change Failed"
        if order.workflow_flag == FLAG_NO_CITY_MATCH:
            return "No City Matched"
        if order.workflow_flag == FLAG_NO_STOCK:
            return "Stock Not Available"
        return "Approved"
    if card == "assigning_courier":
        if status == "dispatch_issue":
            return "Dispatch Issue"
        # Not To Be Packed until the courier has actually given a tracking
        # number - a Smartlane booking waits for one in Booking Pending.
        if status == "booking_pending" or not order.tracking_number:
            return "Awaiting Tracking"
        return "Packed" if order.packed_at else "To Be Packed"
    if card == "dispatched":
        return "Out for Delivery" if status == "out_for_delivery" else "In Transit"
    if card == "undelivered":
        return courier_word or "Delivery Attempt Failed"
    if card == "return_in_transit":
        return (order.return_reason or "").strip() or courier_word or "Return in Transit"
    if card == "returned":
        return (order.return_reason or "").strip() or courier_word or "Returned"
    if card == "cancelled":
        return (order.cancel_reason or "").strip() or "Cancelled"
    if card == "delivered":
        return "Delivered"
    return ""


# The Dashboard's cards (same statuses as its KPI_GROUPS) and, per card,
# the OMS types a click on it breaks its orders into - the card's tags,
# cancel reasons, return reasons or couriers. dashboard_types counts them;
# filter_dashboard_type lists one (the Orders list's dash_group/dash_type).
DASHBOARD_GROUPS = {
    "total": None,
    # Pending: everything not yet handed to the courier - from New up to
    # Assigning Courier (booked, printed, packed, dispatch issue).
    "pending": [
        "new", "pending_cc", "pending_cod", "city_issue", "awaiting_assigning", "awaiting_approval",
        "approved", "booking_pending", "ready_to_print", "ready_to_pick", "awaiting_dispatched",
        "dispatch_issue",
    ],
    "cancelled": ["cancelled"],
    # Dispatched: only orders the courier has actually picked up.
    "dispatched": ["dispatched", "out_for_delivery", "attempt"],
    "delivered": ["delivered"],
    "returned": ["returned"],
}

# Same list as the frontend's CANCEL_REASONS (components/orders/statusConfig.js).
CANCEL_REASONS = ["Customer Cancelled", "On Seller Request", "Order Price Issue", "Fake/Test Order"]

# Cards broken down by a field's own values instead of fixed types:
# (field, label for an empty value).
_DASHBOARD_VALUE_TYPES = {
    "delivered": ("courier__name", "No Courier"),
    "returned": ("return_reason", "No Reason"),
}
_NO_VALUE = "_none"


def _dashboard_fixed_types(group):
    """[(key, label, Q)] for the cards with a fixed list of types."""
    def flagged(flag):
        return Q(status="awaiting_assigning", workflow_flag=flag)

    if group == "pending":
        return [
            ("new", "New", Q(status="new")),
            ("city_issue", "City Issue", Q(status="city_issue")),
            ("pending_approval", "Pending Approval",
             Q(status__in=["pending_cc", "pending_cod", "awaiting_approval"])),
            ("approved", "Approved (Awaiting Courier)", flagged("")),
            ("no_city_match", "No City Matched", flagged(FLAG_NO_CITY_MATCH)),
            ("no_stock", "Stock Not Available", flagged(FLAG_NO_STOCK)),
            ("cancelled_from_assigning", "Cancelled from Assigning Courier", flagged(FLAG_CANCELLED_FROM_ASSIGNING)),
            ("courier_change_failed", "Courier Change Failed", flagged(FLAG_COURIER_CHANGE_FAILED)),
            ("self_delivered", "Self Delivered", Q(status="approved")),
            ("booking_pending", "Awaiting Tracking", Q(status="booking_pending")),
            ("ready_to_print", "Ready to Print", Q(status="ready_to_print")),
            ("ready_to_pick", "Ready to Pick", Q(status="ready_to_pick")),
            ("awaiting_dispatched", "Awaiting Dispatched", Q(status="awaiting_dispatched")),
            ("dispatch_issue", "Dispatch Issue", Q(status="dispatch_issue")),
        ]
    if group == "cancelled":
        return [(reason, reason, Q(cancel_reason=reason)) for reason in CANCEL_REASONS] + [
            ("other", "Other / No Reason", ~Q(cancel_reason__in=CANCEL_REASONS)),
        ]
    if group == "dispatched":
        return [
            ("dispatched", "In Transit", Q(status="dispatched")),
            ("out_for_delivery", "Out for Delivery", Q(status="out_for_delivery")),
            ("attempt", "Delivery Attempt Failed", Q(status="attempt")),
        ]
    if group == "total":
        named = [g for g in DASHBOARD_GROUPS if DASHBOARD_GROUPS[g]]
        every = [s for g in named for s in DASHBOARD_GROUPS[g]]
        return [(g, g.title(), Q(status__in=DASHBOARD_GROUPS[g])) for g in named] + [
            ("other", "Other (New, Booked, Out for Delivery, ...)", ~Q(status__in=every)),
        ]
    return []


def _in_dashboard_group(qs, group):
    statuses = DASHBOARD_GROUPS[group]
    return qs.filter(status__in=statuses) if statuses else qs


def dashboard_types(qs, group):
    """[{key, label, count}] - the card's orders in `qs` (already narrowed
    to the date range etc.) split into its types, every fixed type listed
    even at 0."""
    if group not in DASHBOARD_GROUPS:
        return []
    qs = _in_dashboard_group(qs, group).order_by()
    if group in _DASHBOARD_VALUE_TYPES:
        field, empty_label = _DASHBOARD_VALUE_TYPES[group]
        rows = qs.values_list(field).annotate(n=Count("id")).order_by("-n")
        merged = {}
        for value, n in rows:
            value = (value or "").strip()
            key = value or _NO_VALUE
            label, count = merged.get(key, (value or empty_label, 0))
            merged[key] = (label, count + n)
        return [{"key": k, "label": label, "count": n} for k, (label, n) in merged.items()]
    return [
        {"key": key, "label": label, "count": qs.filter(q).count()}
        for key, label, q in _dashboard_fixed_types(group)
    ]


def filter_dashboard_type(qs, group, key=""):
    """`qs` narrowed to a Dashboard card, and to one of its types when
    `key` is given (see dashboard_types). An unknown card or type matches
    nothing rather than everything."""
    if group not in DASHBOARD_GROUPS:
        return qs.none()
    qs = _in_dashboard_group(qs, group)
    if not key:
        return qs
    if group in _DASHBOARD_VALUE_TYPES:
        field, _ = _DASHBOARD_VALUE_TYPES[group]
        if key == _NO_VALUE:
            return qs.filter(Q(**{f"{field}__isnull": True}) | Q(**{field: ""}))
        return qs.filter(**{field: key})
    for type_key, _label, q in _dashboard_fixed_types(group):
        if type_key == key:
            return qs.filter(q)
    return qs.none()


def with_card_counts(counts, qs):
    """Adds each card's count to the per-status `counts` under
    "card:<card>" - kept apart from the status keys, since Approved and
    Dispatched as cards hold more than the status of the same name. `all`
    must already be summed."""
    returning = dict(
        qs.filter(return_in_progress_at__isnull=False, status__in=RETURNABLE_STATUSES)
        .order_by()
        .values_list("status")
        .annotate(n=Count("id"))
    )
    for card, statuses in WORKFLOW_CARD_STATUSES.items():
        counts[f"card:{card}"] = sum(counts.get(s, 0) - returning.get(s, 0) for s in statuses)
    counts["card:return_in_transit"] = sum(returning.values())
    counts["card:all"] = counts.get("all", 0)
    return counts


def with_ticket_counts(qs):
    """Annotates each order with how many tickets it has, and how many of
    those aren't resolved yet - the orders table's ticket symbol. One
    subquery each, not a join, so nothing else on the queryset (search,
    filters, distinct) can multiply them."""
    from .models import Ticket

    def count(tickets):
        return Coalesce(
            Subquery(
                tickets.filter(order_id=OuterRef("pk"))
                .order_by()
                .values("order_id")
                .annotate(n=Count("id"))
                .values("n")[:1]
            ),
            0,
        )

    return qs.annotate(
        _ticket_count=count(Ticket.all_objects.all()),
        _open_ticket_count=count(Ticket.all_objects.exclude(status="resolved")),
    )


def with_courier_tab_counts(counts, qs):
    """Overwrites counts' Booking Pending and Awaiting Dispatched with what
    those tabs list (above), rather than the plain status count, and New
    with NEW_TAB_STATUSES together. `all` must already be summed - these
    overlap other statuses."""
    counts["booking_pending"] = booking_pending_orders(qs).count()
    counts["awaiting_dispatched"] = awaiting_dispatch_orders(qs).count()
    counts["new"] = sum(counts.get(s, 0) for s in NEW_TAB_STATUSES)
    return counts


def mark_handed_over(order, *, actor_user_id=None, note=""):
    """Ready to Print -> Awaiting Dispatched: the parcel has been handed to
    the courier and waits for its rider. Called when its load sheet is
    generated (any courier) - only that takes an order out of Ready to
    Print. What the courier reports (Unbooked, Booked, Awaiting Pickup,
    ...) only decides which of the Booking Pending / Awaiting Dispatched
    tabs also list it (booking_pending_orders / awaiting_dispatch_orders).

    Returns whether the order moved. Anything not in ON_SHELF_STATUSES
    (already further along, or not booked yet) is left where it is."""
    if order.status == "booking_pending" and order.tracking_number:
        advance_booking_confirmed(order, actor_user_id=actor_user_id)
    if order.status not in ON_SHELF_STATUSES:
        return False
    _transition(order, "awaiting_dispatched", actor_user_id=actor_user_id, note=note)
    return True


def mark_orders_handed_over(orders, *, actor_user_id=None, note=""):
    """mark_handed_over for every order a load sheet was just generated
    for. Best-effort: the sheet is already made, so one order that can't
    move must not fail the download. Returns how many moved."""
    moved = 0
    for order in orders:
        try:
            if mark_handed_over(order, actor_user_id=actor_user_id, note=note):
                moved += 1
        except InvalidTransition:
            logger.info("order %s not moved to Awaiting Dispatched (at %s)", order.order_number, order.status)
    return moved


def dispatch_order(order, *, tracking_number="", actor_user_id=None):
    """One-click "Dispatch" from the detail panel/Actions menu - unlike
    scan_dispatch (which requires the order already be Awaiting Dispatched,
    matching a physical barcode-scan workflow), this also accepts Approved
    orders and queues them for dispatch first, so a single click on an
    Approved order takes it all the way to Dispatched."""
    if order.status == "approved":
        order = _transition(order, "awaiting_dispatched", actor_user_id=actor_user_id)
    extra = {"dispatched_at": timezone.now()}
    if tracking_number:
        extra["tracking_number"] = tracking_number
    return _transition(order, "dispatched", actor_user_id=actor_user_id, extra_fields=extra)


# Statuses where FynkTech can still be asked to dispatch an order: nothing
# has been booked with a courier yet.
DISPATCH_REQUESTABLE_STATUSES = {
    "new", "pending_cc", "pending_cod", "city_issue", "awaiting_assigning",
    "awaiting_approval", "approved",
}


def request_dispatch(order, *, actor_user_id=None):
    """A Dispatch Hub store flags this order as one FynkTech should ship
    for them. Only stores on the Hub may do it - everyone else dispatches
    their own orders - and only before a courier booking exists."""
    from core.models import DispatchHubStore

    if not DispatchHubStore.objects.filter(organization_id=order.organization_id).exists():
        raise InvalidTransition("Dispatch requests are only available to Dispatch Hub stores.")
    if order.status not in DISPATCH_REQUESTABLE_STATUSES:
        raise InvalidTransition(
            f"Order {order.order_number} is {order.get_status_display()} - it can no longer be "
            "sent for dispatch."
        )
    if order.dispatch_requested_at:
        return order
    order.dispatch_requested_at = timezone.now()
    order.save(update_fields=["dispatch_requested_at", "updated_at"])
    OrderStatusEvent.objects.create(
        organization_id=order.organization_id, order=order,
        from_status=order.status, to_status=order.status,
        note="Sent to FynkTech for dispatch", actor_user_id=actor_user_id,
    )
    return order


def withdraw_dispatch_request(order, *, actor_user_id=None):
    if not order.dispatch_requested_at:
        return order
    if order.status not in DISPATCH_REQUESTABLE_STATUSES:
        raise InvalidTransition(
            f"Order {order.order_number} is already {order.get_status_display()} - the dispatch "
            "request can't be withdrawn."
        )
    order.dispatch_requested_at = None
    order.save(update_fields=["dispatch_requested_at", "updated_at"])
    OrderStatusEvent.objects.create(
        organization_id=order.organization_id, order=order,
        from_status=order.status, to_status=order.status,
        note="Dispatch request withdrawn", actor_user_id=actor_user_id,
    )
    return order


def mark_out_for_delivery(order, *, actor_user_id=None):
    """Smartlane-reported sub-stage of dispatched - see ALLOWED_TRANSITIONS.
    Only ever reached via integrations.services.apply_smartlane_status,
    never a manual action."""
    return _transition(order, "out_for_delivery", actor_user_id=actor_user_id)


def mark_delivery_attempt_failed(order, *, actor_user_id=None):
    """Smartlane-reported sub-stage of dispatched - see ALLOWED_TRANSITIONS.
    Only ever reached via integrations.services.apply_smartlane_status,
    never a manual action. Usually followed by another out_for_delivery/
    dispatch event as the courier retries, not an immediate return."""
    return _transition(order, "attempt", actor_user_id=actor_user_id)


def mark_return_in_progress(order, *, courier_label, tracking_number=""):
    """The courier reports the parcel is on its way back: stamps
    Order.return_in_progress_at once, which moves the order to the Return
    in Transit card (workflow_card). Not a status change - the order stays
    in its dispatch sub-stage until the courier says Returned - but it is
    logged and pushed to open Orders pages like one. An order the courier
    already has but we never saw leave (still on the shelf here) is first
    caught up to Dispatched, so it doesn't sit in Assigning Courier.
    Returns whether anything changed; repeats of the same report don't."""
    if order.return_in_progress_at or order.status in ("delivered", "returned", "cancelled"):
        return False
    if order.status in ("ready_to_print", "ready_to_pick", "approved", "awaiting_dispatched"):
        dispatch_order(order, tracking_number=tracking_number)
    order.return_in_progress_at = timezone.now()
    order.save(update_fields=["return_in_progress_at", "updated_at"])
    OrderStatusEvent.objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=order.status,
        to_status=order.status,
        note=f"Return in transit - reported by {courier_label}",
    )
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "return_in_progress",
        },
    )
    return True


def clear_return_in_progress(order, *, courier_label):
    """The courier is trying delivery again (a re-attempt was requested)
    after reporting a return: clears Order.return_in_progress_at, which
    moves the order from Return in Transit back to its own card
    (Undelivered for a failed attempt). Returns whether anything changed."""
    if not order.return_in_progress_at or order.status not in RETURNABLE_STATUSES:
        return False
    order.return_in_progress_at = None
    order.return_reason = ""
    order.save(update_fields=["return_in_progress_at", "return_reason", "updated_at"])
    OrderStatusEvent.objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=order.status,
        to_status=order.status,
        note=f"Re-attempt - return cancelled by {courier_label}",
    )
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "return_in_progress",
        },
    )
    return True


def record_courier_status(order, label):
    """Keeps Order.courier_status - the courier's own word for where the
    parcel is, the orders list's Sub Status - in step with what the courier
    last reported. PostEx's, BarqRaftar's and Smartlane's pollers and
    webhooks call it with every status they read; it only saves, and tells
    open Orders pages, when the word changed. Returns whether it did."""
    label = (label or "").strip()[:100]
    if not label or label == order.courier_status:
        return False
    order.courier_status = label
    order.save(update_fields=["courier_status", "updated_at"])
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "courier_status",
        },
    )
    return True


def record_return_reason(order, reason):
    """Keeps Order.return_reason - the courier's latest remark on why the
    parcel is coming back ("REFUSED TO RECEIVE") - on an order in Return in
    Transit, where it's the card's tag (workflow_tag). Pollers call it with
    every remark they read; it only saves when the remark changed. Returns
    whether it did."""
    reason = (reason or "").strip()[:255]
    if (
        not reason
        or reason == order.return_reason
        or not order.return_in_progress_at
        or order.status not in RETURNABLE_STATUSES
    ):
        return False
    order.return_reason = reason
    order.save(update_fields=["return_reason", "updated_at"])
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "return_reason",
        },
    )
    return True


def cancel_fulfillment(order, *, actor_user_id=None):
    """Resets fulfillment_status only - independent of the pipeline `status`
    axis (same reasoning as payment_status), so this isn't a state-machine
    transition and doesn't write an OrderStatusEvent."""
    order.fulfillment_status = "unfulfilled"
    order.save(update_fields=["fulfillment_status", "updated_at"])
    return order


def scan_dispatch(*, organization_id, order_number, tracking_number="", actor_user_id=None):
    """Looks up by order_number instead of id - the scanner UX reads a
    barcode/text code, not a UUID. Returns a structured result instead of
    raising, so the scan UI can beep-and-continue on a bad/out-of-sequence
    scan instead of treating every miss as a hard error."""
    order = Order.objects.filter(organization_id=organization_id, order_number=order_number).first()
    if not order:
        return {"success": False, "reason": "not_found", "order_number": order_number}
    if order.status != "awaiting_dispatched":
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Awaiting Dispatched",
            "order_number": order_number,
        }
    extra = {"dispatched_at": timezone.now()}
    if tracking_number:
        extra["tracking_number"] = tracking_number
    order = _transition(order, "dispatched", actor_user_id=actor_user_id, extra_fields=extra)
    return {"success": True, "order_id": str(order.id), "order_number": order.order_number}


def scan_pack(order, *, code, actor_user_id=None, actor_email=""):
    """Assigning Courier's Scan: the parcel's barcode (its tracking number,
    or the order number) scanned at the bench turns its tag from To Be
    Packed to Packed. Only stamps packed_at - the status stays, so printing
    and the load sheet carry on exactly as before. Returns a structured
    result instead of raising, like scan_dispatch."""
    if order is None:
        return {"success": False, "reason": "Unknown barcode - no order has this tracking or order number", "order_number": code}
    result = {"order_id": str(order.id), "order_number": order.order_number}
    if workflow_card(order) != "assigning_courier":
        return {**result, "success": False, "reason": f"Order is {order.get_status_display()}, not in Assigning Courier"}
    if order.status == "booking_pending" or not order.tracking_number:
        return {**result, "success": False, "reason": "No tracking number from the courier yet - can't pack it"}
    if order.status == "dispatch_issue":
        return {**result, "success": False, "reason": "Order has a dispatch issue - resolve it first"}
    if order.packed_at:
        return {**result, "success": False, "reason": "Already packed"}

    # Conditional, so two scans of the same parcel landing together can't
    # both pack it.
    now = timezone.now()
    packed = Order.all_objects.filter(id=order.id, packed_at__isnull=True).update(
        packed_at=now, packed_by_email=(actor_email or "")[:255], updated_at=now
    )
    if not packed:
        return {**result, "success": False, "reason": "Already packed"}
    OrderStatusEvent.objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=order.status,
        to_status=order.status,
        note=f"Packed (scanned {code})",
        actor_user_id=actor_user_id,
    )
    # A queryset update, so oms.signals' change log doesn't see it.
    _log_order_change(order, f"Packed (scanned {code})", actor_user_id=actor_user_id)
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "scan_pack",
        },
    )
    return {**result, "success": True, "tracking_number": order.tracking_number}


def scan_return(*, organization_id, order_number, reason="", actor_user_id=None):
    order = Order.objects.filter(organization_id=organization_id, order_number=order_number).first()
    if not order:
        return {"success": False, "reason": "not_found", "order_number": order_number}
    if order.status not in ("dispatched", "delivered"):
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Dispatched/Delivered",
            "order_number": order_number,
        }
    order = _transition(
        order,
        "returned",
        actor_user_id=actor_user_id,
        note=reason,
        extra_fields={"returned_at": timezone.now(), "return_reason": reason},
    )
    return {"success": True, "order_id": str(order.id), "order_number": order.order_number}


# --- Read helpers ------------------------------------------------------

def get_probability_map(*, organization_filter, phone_numbers):
    """Historical cancelled/returned/delivered percentages per customer
    phone number, computed once per list-request for only the phone
    numbers on the current page (not a per-row query, not stored on
    Order - avoids a stale-cache/write-fanout problem).

    `organization_filter` is core.scoping.org_filter(request)'s dict -
    {"organization_id": id} normally, {"organization_id__in": ids} for a
    super admin operating the Dispatch Hub - so a phone number is never
    compared across stores that don't actually share it."""
    phone_numbers = [p for p in set(phone_numbers) if p]
    if not phone_numbers:
        return {}

    rows = (
        Order.objects.filter(customer_phone__in=phone_numbers, **organization_filter)
        .values("customer_phone")
        .annotate(
            total=Count("id"),
            cancelled=Count("id", filter=Q(status="cancelled")),
            returned=Count("id", filter=Q(status="returned")),
            delivered=Count("id", filter=Q(status="delivered")),
        )
    )

    result = {}
    for row in rows:
        total = row["total"] or 1
        result[row["customer_phone"]] = {
            "cancelled_pct": round(row["cancelled"] * 100 / total),
            "returned_pct": round(row["returned"] * 100 / total),
            "delivered_pct": round(row["delivered"] * 100 / total),
        }
    return result


# --- Order detail panel --------------------------------------------------

# With the courier or past it - the parcel's details are on the courier's
# booking now, so the order can't be edited here any more.
# Only Awaiting Confirmation can be edited - from Approved on, an order is
# locked (Assigning Courier's Edit Order cancels the booking and brings it
# back to Awaiting Confirmation first - unbook_for_edit).
EDIT_LOCKED_STATUSES = {
    "awaiting_assigning", "approved", "booking_pending", "ready_to_print", "ready_to_pick",
    "awaiting_dispatched", "dispatch_issue", "dispatched", "out_for_delivery", "attempt",
    "delivered", "returned", "cancelled",
}


def update_order_detail(order, *, fields, items=None):
    """Applies the editable profile/money fields from the detail panel's
    single Edit toggle. `items` (when provided) fully replaces the order's
    line items - same delete+recreate strategy as
    integrations.services.upsert_order_from_shopify, simpler and safer than
    diffing. Refused once the order is dispatched (EDIT_LOCKED_STATUSES)."""
    if order.status in EDIT_LOCKED_STATUSES:
        raise InvalidTransition(
            f"Order {order.order_number} is {dict(Order.STATUS_CHOICES).get(order.status, order.status)} "
            "- only orders in Awaiting Confirmation can be edited."
        )
    for field, value in fields.items():
        setattr(order, field, value)
    order.save()

    if items is not None:
        order.items.all().delete()
        total = 0
        for item in items:
            order_item = order.items.create(organization_id=order.organization_id, **item)
            total += order_item.quantity * order_item.unit_price
        order.total_amount = total
        order.save(update_fields=["total_amount"])

    # Drops the store's cached Orders lists and patches its open tabs
    # (core/realtime.py) - without it an edit made elsewhere, e.g. from the
    # Dispatch Hub, kept showing the old values to the store.
    publish_event(
        "order.updated",
        {
            "organization_id": str(order.organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
        },
    )
    return order


def order_items_summary(order):
    """"Comb x 2, Brush x 1" - read fresh, not through a prefetch."""
    return ", ".join(
        f"{i.product_name} x {i.quantity}"
        for i in OrderItem.objects.filter(order_id=order.id).order_by("product_name", "id")
    )


def _display(value):
    """A field value the way a person reads it in a change list."""
    if value is None or value == "":
        return "-"
    if isinstance(value, Decimal):
        text = f"{value:f}"
        return text.rstrip("0").rstrip(".") if "." in text else text
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def order_changes(order, before, items_before=None):
    """[{"field", "label", "old", "new"}] for what an edit actually changed:
    `before` is {field: value} taken just before update_order_detail, and
    `items_before` the order_items_summary then (None if items weren't part
    of the edit)."""
    changes = []
    for field, old in before.items():
        new = getattr(order, field)
        if _display(old) == _display(new):
            continue
        label = str(Order._meta.get_field(field).verbose_name)
        changes.append({
            "field": field,
            "label": label[:1].upper() + label[1:],
            "old": _display(old),
            "new": _display(new),
        })
    if items_before is not None:
        items_after = order_items_summary(order)
        if items_after != items_before:
            changes.append({
                "field": "items", "label": "Items",
                "old": items_before or "-", "new": items_after or "-",
            })
    return changes


def split_order(order, *, item_splits, actor_user_id=None):
    """Creates a child Order (parent_order=order) carrying the given items.
    item_splits: [{"item_id": ..., "quantity": ...}, ...] - quantities are
    moved out of the parent's matching OrderItem (deleted if it reaches 0)."""
    existing_children = order.split_orders.count()
    child = Order.objects.create(
        organization_id=order.organization_id,
        order_number=f"{order.order_number}-{existing_children + 2}",
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        customer_email=order.customer_email,
        city=order.city,
        shop=order.shop,
        payment_gateway=order.payment_gateway,
        status=order.status,
        parent_order=order,
    )

    total = 0
    for split in item_splits:
        source_item = order.items.get(id=split["item_id"])
        quantity = min(int(split["quantity"]), source_item.quantity)
        if quantity <= 0:
            continue
        child.items.create(
            organization_id=order.organization_id,
            product_name=source_item.product_name,
            quantity=quantity,
            unit_price=source_item.unit_price,
            vendor=source_item.vendor,
            barcode=source_item.barcode,
        )
        total += quantity * source_item.unit_price

        if quantity >= source_item.quantity:
            source_item.delete()
        else:
            source_item.quantity -= quantity
            source_item.save(update_fields=["quantity"])

    child.total_amount = total
    child.save(update_fields=["total_amount"])

    # Parent's total_amount reflects the items it has left. Query fresh
    # (not order.items.all()) - the view's queryset prefetches `items`, so
    # `.all()` would serve the stale pre-mutation cache on the `order`
    # instance instead of the rows just updated/deleted above.
    order.total_amount = sum(
        i.quantity * i.unit_price for i in OrderItem.objects.filter(order_id=order.id)
    )
    order.save(update_fields=["total_amount"])

    OrderStatusEvent.objects.create(
        organization_id=order.organization_id,
        order=order,
        from_status=order.status,
        to_status=order.status,
        note=f"Split into {child.order_number}",
        actor_user_id=actor_user_id,
    )
    return child


# --- Critical orders ---------------------------------------------------------
#
# Not a status of its own: "critical" is an order that has sat in the
# couriers' "In Transit" stage for more than CRITICAL_TRANSIT_DAYS. That
# stage is exactly what OMS's plain "dispatched" status means - Smartlane's
# dispatch/in_transit, PostEx's en-route/warehouse/transferred and
# BarqRaftar's picked up/in transit/received at FC all land there (see
# integrations.services._SMARTLANE_DISPATCH_STATUSES, postex.services.
# _STAGE_BY_STATUS, barqraftar.services._DISPATCH_CODES). Out for Delivery
# and Delivery Attempt Failed have statuses of their own and are NOT
# included - those orders stay in their own tabs only. It leaves the moment
# the courier reports anything further, so nothing is stored - the Orders
# "Critical Orders" tab and its alert are computed from this each time,
# which is also why it stays out of every cache (the answer changes with
# the clock, not only when an order changes).
IN_TRANSIT_STATUSES = ("dispatched",)
CRITICAL_TRANSIT_DAYS = 3


def critical_transit_orders(qs):
    """`qs` narrowed to orders In Transit longer than CRITICAL_TRANSIT_DAYS,
    each annotated with `_in_transit_since` (not ordered - callers that want
    the oldest first order_by it).

    In transit since: when it was dispatched here, else when it first
    reached Dispatched (orders Smartlane/the courier moved there on their
    own don't always carry dispatched_at). An order with neither never went
    through a courier here - typically one Shopify delivered already
    fulfilled, with no tracking - so there is no moment to count from and
    it is left out, rather than guessed at from when it was placed."""
    first_dispatched = (
        OrderStatusEvent.objects.filter(order=OuterRef("pk"), to_status="dispatched")
        .order_by("created_at")
        .values("created_at")[:1]
    )
    cutoff = timezone.now() - timedelta(days=CRITICAL_TRANSIT_DAYS)
    return (
        qs.filter(status__in=IN_TRANSIT_STATUSES)
        .annotate(
            _in_transit_since=Coalesce(
                "dispatched_at",
                Subquery(first_dispatched),
                output_field=DateTimeField(),
            )
        )
        .filter(_in_transit_since__lte=cutoff)
    )


def compute_order_counts(organization_id):
    """The per-status counts behind the Orders tabs, straight from Postgres.

    Extracted from OrderViewSet._counts_payload so core/realtime.py can
    rebuild the cached value on a write instead of only deleting it - see
    core/redis_client.set_cached_counts. Takes an organization_id rather
    than a request because the realtime path has no request.
    """
    rows = (
        Order.objects.filter(organization_id=organization_id)
        .values("status")
        .annotate(count=Count("id"))
    )
    counts = {value: 0 for value, _label in Order.STATUS_CHOICES}
    for row in rows:
        counts[row["status"]] = row["count"]
    counts["all"] = sum(counts.values())
    qs = Order.objects.filter(organization_id=organization_id)
    # Cards first - they add up the plain status counts, which the courier
    # tabs below then overwrite.
    with_card_counts(counts, qs)
    return with_courier_tab_counts(counts, qs)


# --------------------------------------------------- Critical Orders page --
# Each card on the Critical Orders page: (key, label, what it means, a
# function narrowing an Order queryset to its orders). An order can sit
# under more than one card. The page lists them with
# ?critical_reason=<key> (OrderViewSet._apply_filters).
STUCK_BOOKING_HOURS = 24
COURIER_CANCEL_NOTE_PREFIX = "Booking cancelled on "


def _stuck_in_booking(qs):
    return qs.filter(
        status="booking_pending",
        updated_at__lt=timezone.now() - timedelta(hours=STUCK_BOOKING_HOURS),
    )


def _booking_cancelled_by_courier(qs):
    # Back in Approved because the courier cancelled the booking
    # (unbook_cancelled_by_courier) and not booked again since.
    from django.db.models import Exists

    latest_move_here = (
        OrderStatusEvent.all_objects.filter(order_id=OuterRef("pk"), to_status="awaiting_assigning")
        .order_by("-created_at")
        .values("note")[:1]
    )
    return (
        qs.filter(status="awaiting_assigning")
        .annotate(_last_note=Subquery(latest_move_here))
        .filter(_last_note__startswith=COURIER_CANCEL_NOTE_PREFIX)
    )


CRITICAL_REASONS = [
    (
        "in_transit",
        f"In transit {CRITICAL_TRANSIT_DAYS}+ days",
        f"Dispatched more than {CRITICAL_TRANSIT_DAYS} days ago and still not delivered.",
        lambda qs: critical_transit_orders(qs).order_by("_in_transit_since"),
    ),
    (
        "attempt",
        "Delivery attempt failed",
        "The courier couldn't deliver - needs a call to the customer.",
        lambda qs: qs.filter(status="attempt"),
    ),
    (
        "dispatch_issue",
        "Dispatch issue",
        "Marked with a dispatch issue and not dispatched yet.",
        lambda qs: qs.filter(status="dispatch_issue"),
    ),
    (
        "city_issue",
        "City issue",
        "The city needs fixing before it can go to a courier.",
        lambda qs: qs.filter(status="city_issue"),
    ),
    (
        "stuck_booking",
        f"Stuck in booking {STUCK_BOOKING_HOURS}h+",
        f"In Awaiting Booking for more than {STUCK_BOOKING_HOURS} hours.",
        _stuck_in_booking,
    ),
    (
        "courier_cancelled",
        "Booking cancelled by courier",
        "The courier cancelled the booking - back in Approved to book again.",
        _booking_cancelled_by_courier,
    ),
]
CRITICAL_REASON_FILTERS = {key: fn for key, _label, _hint, fn in CRITICAL_REASONS}


def critical_summary(qs):
    """[{key, label, description, count}] for the Critical Orders page's
    cards, over `qs` (already scoped to the store / Dispatch Hub)."""
    return [
        {"key": key, "label": label, "description": hint, "count": fn(qs).count()}
        for key, label, hint, fn in CRITICAL_REASONS
    ]


# ----------------------------------------------- Dashboard: delivery rate --
def _rate(delivered, dispatched):
    """Delivered out of the orders dispatched - every order the courier
    picked up, whether it's still on the way, delivered or returned (see
    delivery_performance) - None while none was dispatched."""
    return round(delivered * 100 / dispatched, 1) if dispatched else None


# Every status an order reaches only once the courier has picked it up -
# the delivery rate's "dispatched".
_DISPATCHED_STATUSES = {"dispatched", "out_for_delivery", "attempt", "delivered", "returned"}


def _share(part, whole):
    return round(part * 100 / whole, 1) if whole else 0.0


# The couriers the Top couriers card names (matched ignoring case and
# spaces); every other courier name, and orders with none, show as "Others".
DASHBOARD_COURIERS = {
    re.sub(r"[^a-z]", "", name.lower()): name
    for name in ("PostEx", "BarqRaftar", "Smartlane", "Leopards")
}
DASHBOARD_OTHER_COURIERS = "Others"


def _dashboard_courier(name):
    return DASHBOARD_COURIERS.get(re.sub(r"[^a-z]", "", (name or "").lower()), DASHBOARD_OTHER_COURIERS)


# How the Top Couriers card writes a province.
_SHORT_PROVINCE_NAMES = {"Khyber Pakhtunkhwa": "KPK", "Islamabad Capital Territory": "Islamabad"}


def delivery_performance(qs):
    """The Dashboard's Delivery performance section, over `qs` (the picked
    date range): overall, each courier's share of the orders and delivery
    rate, and the same by Pakistani province - overall and per courier.
    One grouped query (courier, city, status, returning), folded here.

    - Only dispatched orders count (_DISPATCHED_STATUSES: in transit,
      delivered or returned) - pending and cancelled ones are left out, so
      "orders" and every share are of dispatched orders.
    - Delivery % is delivered out of those dispatched orders.
    - Orders whose courier isn't one of DASHBOARD_COURIERS count under
      Others."""
    from .pakistan_provinces import province_for_city

    rows = (
        qs.order_by()
        .values("courier__name", "city", "status")
        .annotate(
            returning=ExpressionWrapper(
                Q(return_in_progress_at__isnull=False, status__in=RETURNABLE_STATUSES),
                output_field=BooleanField(),
            ),
        )
        .values("courier__name", "city", "status", "returning")
        .annotate(n=Count("id"))
    )

    def bucket():
        return {"orders": 0, "dispatched": 0, "delivered": 0, "returned": 0}

    total = bucket()
    # Orders with a courier at all - what a courier's share is out of.
    with_courier = 0
    # The named couriers always show, at 0% when they had no orders.
    couriers = {name: bucket() for name in DASHBOARD_COURIERS.values()}
    provinces, courier_provinces = {}, {name: {} for name in DASHBOARD_COURIERS.values()}
    for row in rows:
        # Only orders the courier picked up count anywhere here - nothing
        # before Dispatched (pending, booked) and nothing cancelled.
        if row["status"] not in _DISPATCHED_STATUSES:
            continue
        province = province_for_city(row["city"])
        n = row["n"]
        targets = [total, provinces.setdefault(province, bucket())]
        if row["courier__name"]:
            courier = _dashboard_courier(row["courier__name"])
            with_courier += n
            targets += [
                couriers.setdefault(courier, bucket()),
                courier_provinces.setdefault(courier, {}).setdefault(province, bucket()),
            ]
        for b in targets:
            b["orders"] += n
            if row["status"] in _DISPATCHED_STATUSES:
                b["dispatched"] += n
            if row["status"] == "delivered":
                b["delivered"] += n
            elif row["status"] == "returned" or row["returning"]:
                b["returned"] += n

    def summary(name, b, whole):
        return {
            "name": _SHORT_PROVINCE_NAMES.get(name, name),
            "orders": b["orders"],
            "delivered": b["delivered"],
            "returned": b["returned"],
            "share_pct": _share(b["orders"], whole),
            "dispatched": b["dispatched"],
            "delivery_pct": _rate(b["delivered"], b["dispatched"]),
        }

    def by_province(groups, whole):
        return sorted(
            (summary(name, b, whole) for name, b in groups.items()),
            key=lambda r: (r["name"] == "Unknown", -r["orders"]),
        )

    return {
        "overall": summary("Overall", total, total["orders"]),
        "couriers": [
            {
                **summary(name, b, with_courier),
                "provinces": by_province(courier_provinces.get(name, {}), b["orders"]),
            }
            for name, b in sorted(
                couriers.items(), key=lambda kv: (kv[0] == DASHBOARD_OTHER_COURIERS, -kv[1]["orders"])
            )
        ],
        "provinces": by_province(provinces, total["orders"]),
    }


def store_ids_for(pairs):
    """{(organization_id, store name): Store ID} for the given pairs - the
    orders report's Store ID column. A store name seen for the first time
    gets its number here (oms.Store), so every report row has one. Blank
    names have no store and are left out."""
    from django.db import IntegrityError

    from .models import Store

    pairs = {(str(org_id), name) for org_id, name in pairs if name}
    if not pairs:
        return {}
    org_ids = {org_id for org_id, _ in pairs}
    found = {
        (str(org_id), name): store_id
        for org_id, name, store_id in Store.all_objects.filter(
            organization_id__in=org_ids, name__in={name for _, name in pairs}
        ).values_list("organization_id", "name", "store_id")
    }
    for org_id, name in sorted(pairs - found.keys()):
        try:
            with transaction.atomic():
                store = Store.all_objects.create(organization_id=org_id, name=name)
            store.refresh_from_db(fields=["store_id"])
        except IntegrityError:
            # Made by a parallel request a moment ago.
            store = Store.all_objects.get(organization_id=org_id, name=name)
        found[(org_id, name)] = store.store_id
    return {pair: found[pair] for pair in pairs}
