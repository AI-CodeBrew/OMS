from django.db.models import Count, Q
from django.utils import timezone

from core.events import publish_event

from .models import Courier, Order, OrderItem, OrderStatusEvent


def create_order(*, organization_id, order_number, customer_name, customer_phone, items):
    """Business logic for order creation lives here, not in the view - keeps
    OrderViewSet thin and gives WMS/Finance one place (the order.created
    event) to react to without importing oms's models directly."""
    order = Order.objects.create(
        organization_id=organization_id,
        order_number=order_number,
        customer_name=customer_name,
        customer_phone=customer_phone or "",
        status="pending_cod",
        shop="Manual",
        order_source="Manual",
    )

    total = 0
    for item in items:
        order_item = order.items.create(
            organization_id=organization_id,
            product_name=item["product_name"],
            quantity=item["quantity"],
            unit_price=item["unit_price"],
        )
        total += order_item.quantity * order_item.unit_price

    order.total_amount = total
    order.save(update_fields=["total_amount"])

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


# --- Status pipeline -------------------------------------------------------
#
# pending_cc / pending_cod -> city_issue -> awaiting_assigning ->
# awaiting_approval -> approved -> awaiting_dispatched -> dispatch_issue ->
# dispatched -> delivered -> returned
# (cancelled reachable from any pre-dispatch status)

ALLOWED_TRANSITIONS = {
    # Untouched inbox - CS picks it up into Pending CC/COD (whichever
    # matches the payment gateway, see acknowledge_order) before working
    # it. Cancel stays reachable so junk/test orders don't have to be
    # walked through the whole pipeline first.
    "new": {"pending_cc", "pending_cod", "cancelled"},
    "pending_cc": {"awaiting_assigning", "city_issue", "cancelled"},
    "pending_cod": {"awaiting_assigning", "city_issue", "cancelled"},
    "city_issue": {"awaiting_assigning", "cancelled"},
    # ready_to_print is reached directly from here when a courier is pushed
    # to Smartlane instead of assigned to a manual courier - a parallel
    # branch alongside the awaiting_approval path, not a replacement.
    "awaiting_assigning": {"awaiting_approval", "ready_to_print", "cancelled"},
    "awaiting_approval": {"approved", "awaiting_assigning", "cancelled"},
    "approved": {"awaiting_dispatched", "cancelled"},
    "ready_to_print": {"ready_to_pick", "cancelled"},
    "ready_to_pick": {"dispatched", "cancelled"},
    "awaiting_dispatched": {"dispatched", "dispatch_issue", "cancelled"},
    "dispatch_issue": {"awaiting_dispatched", "cancelled"},
    "dispatched": {"delivered", "returned"},
    "delivered": {"returned"},
    "cancelled": set(),
    "returned": set(),
}


class InvalidTransition(Exception):
    pass


class SmartlaneBookingError(Exception):
    pass


def _transition(order, to_status, *, actor_user_id=None, note="", extra_fields=None):
    allowed = ALLOWED_TRANSITIONS.get(order.status, set())
    if to_status not in allowed:
        raise InvalidTransition(
            f"Cannot move order {order.order_number} from {order.status!r} to {to_status!r}"
        )

    from_status = order.status
    order.status = to_status
    update_fields = ["status", "updated_at"]
    if extra_fields:
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
    """New -> Pending CC/COD. The CS team taking an order out of the
    untouched inbox and starting work on it; which Pending bucket it lands
    in follows the order's own payment gateway rather than being chosen."""
    to_status = "pending_cc" if order.payment_gateway == "cc" else "pending_cod"
    return _transition(order, to_status, actor_user_id=actor_user_id)


def confirm_order(order, *, city_ok=True, actor_user_id=None):
    to_status = "awaiting_assigning" if city_ok else "city_issue"
    return _transition(order, to_status, actor_user_id=actor_user_id)


def resolve_city_issue(order, *, new_city, actor_user_id=None):
    return _transition(
        order,
        "awaiting_assigning",
        actor_user_id=actor_user_id,
        extra_fields={"city": new_city},
    )


def assign_courier(order, *, courier_id, actor_user_id=None):
    return _transition(
        order,
        "awaiting_approval",
        actor_user_id=actor_user_id,
        extra_fields={"courier_id": courier_id},
    )


def approve_order(order, *, actor_user_id=None):
    return _transition(order, "approved", actor_user_id=actor_user_id)


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


def retry_dispatch(order, *, actor_user_id=None):
    return _transition(order, "awaiting_dispatched", actor_user_id=actor_user_id)


def mark_delivered(order, *, actor_user_id=None):
    # Manual only in v1 - no courier delivery webhook/API integration exists.
    return _transition(
        order, "delivered", actor_user_id=actor_user_id, extra_fields={"delivered_at": timezone.now()}
    )


def cancel_order(order, *, reason="", actor_user_id=None):
    return _transition(order, "cancelled", actor_user_id=actor_user_id, note=reason)


def push_order_to_smartlane(order, *, actor_user_id=None, force=False):
    """Creates a Smartlane booking for this order and moves it straight to
    Ready to Print - the Smartlane-assigned equivalent of the manual
    Approve/Dispatch path, triggered from the "Assign courier" modal when
    the user picks Smartlane instead of a real Courier row.

    Stock is checked *before* the booking is created: if the warehouse is
    short and force=False, wms.services.InsufficientStock propagates to the
    caller so the UI can show the shortage and offer to proceed anyway.
    Checking first matters - booking with Smartlane and only then finding
    out we can't fulfil would leave a real consignment we'd have to cancel.
    """
    from integrations import smartlane_client
    from integrations.models import SmartlaneConnection
    from wms import services as wms_services

    # Raises InsufficientStock unless force - deliberately before any
    # outbound Smartlane call.
    shortages = wms_services.check_order_stock(order)
    if shortages and not force:
        raise wms_services.InsufficientStock(shortages)

    try:
        connection = SmartlaneConnection.objects.get(
            organization_id=order.organization_id, is_connected=True
        )
    except SmartlaneConnection.DoesNotExist:
        raise SmartlaneBookingError("Connect Smartlane from the Integrations page first.")

    try:
        tracking_number = smartlane_client.create_booking(order, connection.api_key)
    except smartlane_client.SmartlaneAPIError as exc:
        raise SmartlaneBookingError(str(exc)) from exc

    courier, _ = Courier.objects.get_or_create(
        organization_id=order.organization_id, name="Smartlane", defaults={"is_active": True}
    )
    order = _transition(
        order,
        "ready_to_print",
        actor_user_id=actor_user_id,
        extra_fields={"courier_id": courier.id, "tracking_number": tracking_number},
    )
    # force=True here because the shortage decision was already made above -
    # re-checking would raise on exactly the case the user just approved.
    wms_services.consume_for_order(order, force=True, actor_user_id=actor_user_id)
    return order


def mark_ready_to_pick(order, *, actor_user_id=None):
    # Triggered as a side effect of downloading the loadsheet (see
    # OrderViewSet.loadsheet) rather than a standalone user action - the
    # download itself is the "picked up for warehouse picking" signal.
    return _transition(order, "ready_to_pick", actor_user_id=actor_user_id)


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

def get_probability_map(*, organization_id, phone_numbers):
    """Historical cancelled/returned/delivered percentages per customer
    phone number, computed once per list-request for only the phone
    numbers on the current page (not a per-row query, not stored on
    Order - avoids a stale-cache/write-fanout problem)."""
    phone_numbers = [p for p in set(phone_numbers) if p]
    if not phone_numbers:
        return {}

    rows = (
        Order.objects.filter(organization_id=organization_id, customer_phone__in=phone_numbers)
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

def update_order_detail(order, *, fields, items=None):
    """Applies the editable profile/money fields from the detail panel's
    single Edit toggle. `items` (when provided) fully replaces the order's
    line items - same delete+recreate strategy as
    integrations.services.upsert_order_from_shopify, simpler and safer than
    diffing."""
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

    return order


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
