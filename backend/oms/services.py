import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, DateTimeField, OuterRef, Q, Subquery
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

    order = Order.objects.create(
        organization_id=organization_id,
        order_number=order_number,
        customer_name=customer_name,
        customer_phone=customer_phone or "",
        status="new",
        shop="Manual",
        order_source="Manual",
        **(extra_fields or {}),
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
    "new": {"awaiting_assigning", "pending_cc", "pending_cod", "cancelled"},
    "pending_cc": {"awaiting_assigning", "city_issue", "cancelled"},
    "pending_cod": {"awaiting_assigning", "city_issue", "cancelled"},
    "city_issue": {"awaiting_assigning", "cancelled"},
    # booking_pending is reached directly from here when a courier is
    # pushed to Smartlane instead of assigned to a manual courier - a
    # parallel branch alongside the awaiting_approval path, not a
    # replacement.
    "awaiting_assigning": {"awaiting_approval", "booking_pending", "cancelled"},
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
    # loadsheet/airway-bill downloads as needed. Nothing about printing a
    # document is itself a dispatch signal any more, so downloading alone
    # no longer advances it; moving to Ready to Pick is now an explicit
    # manual action (see services.mark_ready_to_pick), same as a real
    # dispatch (courier pickup reported by Smartlane, or the manual
    # Dispatch action) moving it straight to Dispatched instead.
    "ready_to_print": {"ready_to_pick", "dispatched", "cancelled"},
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
    pipeline). Every other call site must keep going through _transition."""
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
    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=order.organization_id,
            action="order.status_change",
            summary=f"Order {order.order_number}: {from_status} → {to_status}",
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
    try:
        from integrations.services import sync_order_to_shopify

        sync_order_to_shopify(order)
    except Exception:
        pass
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
    """New -> Awaiting Assigning. The CS team taking an order out of the
    untouched inbox and starting work on it. (This used to stop in Pending
    CC/COD first, needing a separate Confirm - that step is gone.)"""
    return _transition(order, "awaiting_assigning", actor_user_id=actor_user_id)


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


def cancel_order(order, *, reason="", actor_user_id=None, propagate_to_courier=True):
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

        try:
            from integrations import smartlane_client
            from integrations.models import SmartlaneConnection

            connection = SmartlaneConnection.for_order(order)
            smartlane_client.cancel_consignment(
                connection.api_key, SmartlaneConnection.reference_for(order)
            )
        except Exception:
            pass
        # consume_for_order only ever runs for a Smartlane courier (push_
        # order_to_smartlane/absorb_smartlane_booking, both set that courier
        # in the same breath as consuming), so this is exactly
        # the population that has stock to put back. Idempotent per order
        # (release_order_stock checks for its own prior reversal), so this
        # is safe even if abandon_smartlane_booking already released it.
        wms_services.release_order_stock(
            order, actor_user_id=actor_user_id, note="Order cancelled by Smartlane/staff"
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
    return _transition(order, "cancelled", actor_user_id=actor_user_id, note=reason)


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
    (integrations/services.py) is unaffected and unchanged."""
    return _transition(
        order, "returned", actor_user_id=actor_user_id, note=reason,
        extra_fields={"returned_at": timezone.now(), "return_reason": (reason or "")[:255]},
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
        extra_fields={"courier_id": None, "tracking_number": "", "platform_reference": ""},
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
    return counts
