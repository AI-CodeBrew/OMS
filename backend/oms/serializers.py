from django.utils import timezone
from rest_framework import serializers

from .models import (
    Courier,
    DispatchBatch,
    DispatchBatchOrder,
    Order,
    OrderItem,
    OrderNote,
    OrderStatusEvent,
    OrderTransaction,
    PrintBatch,
    Ticket,
    TicketMessage,
)


class PrintBatchSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()
    # Only meaningful in the super admin's Dispatch Hub, same as
    # OrderSerializer.store_name above.
    store_name = serializers.CharField(source="organization.name", read_only=True, default="")

    class Meta:
        model = PrintBatch
        fields = [
            "id",
            "organization_id",
            "store_name",
            "kind",
            "courier",
            "order_count",
            "order_numbers",
            "content_type",
            "created_at",
            "updated_at",
            "download_url",
        ]

    def get_download_url(self, batch):
        return f"/api/oms/print-batches/{batch.id}/download/"


class DispatchBatchOrderSerializer(serializers.ModelSerializer):
    # The order as it is now - the batch card prints only the ones still
    # booked (a tracking number), with the courier that booked them.
    courier_name = serializers.SerializerMethodField()
    tracking_number = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = DispatchBatchOrder
        fields = ["id", "order_id", "order_number", "removed_at", "courier_name", "tracking_number", "status"]

    def get_courier_name(self, entry):
        order = entry.order
        return order.courier.name if order is not None and order.courier_id else ""

    def get_tracking_number(self, entry):
        return entry.order.tracking_number if entry.order is not None else ""

    def get_status(self, entry):
        return entry.order.status if entry.order is not None else ""


class DispatchBatchSerializer(serializers.ModelSerializer):
    """One Batch page History card - the batch, its orders (removed ones
    included, flagged by removed_at) and every document printed for it.
    Relies on the viewset's prefetch of entries/documents."""

    batch_number = serializers.CharField(read_only=True)
    store_name = serializers.CharField(source="organization.name", read_only=True, default="")
    entries = DispatchBatchOrderSerializer(many=True, read_only=True)
    documents = PrintBatchSerializer(many=True, read_only=True)
    order_count = serializers.SerializerMethodField()

    class Meta:
        model = DispatchBatch
        fields = [
            "id",
            "batch_number",
            "organization_id",
            "store_name",
            "courier",
            "source",
            "order_count",
            "entries",
            "documents",
            "created_at",
            "updated_at",
        ]

    def get_order_count(self, batch):
        return sum(1 for e in batch.entries.all() if e.removed_at is None)


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = [
            "id",
            "product_name",
            "quantity",
            "unit_price",
            "vendor",
            "barcode",
            # Stock units in one of this line ("Pack of 2" = 2) - sent back
            # by the Edit form so saving products never resets it.
            "pack_units",
            "compare_at_price",
            "discount_amount",
            "weight_grams",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {"pack_units": {"required": False, "min_value": 1}}


class CourierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Courier
        fields = ["id", "name", "is_active"]
        read_only_fields = ["id"]


def _show_original_number(order, data):
    """A booking cancel renumbers the order in the database (1001 ->
    1001-1); screens keep showing the number it had."""
    if getattr(order, "original_order_number", "") and "order_number" in data:
        data["order_number"] = order.original_order_number
    return data


class OrderSummarySerializer(serializers.ModelSerializer):
    """Lightweight - used for Split Orders / Customer History tabs, which
    only need to list sibling orders, not their full detail. workflow_card:
    the card shown as its status (never the backend's own status)."""

    workflow_card = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ["id", "order_number", "status", "workflow_card", "total_amount", "created_at"]

    def get_workflow_card(self, order):
        from .services import workflow_card

        return workflow_card(order)

    def to_representation(self, order):
        return _show_original_number(order, super().to_representation(order))


class OrderStatusEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusEvent
        fields = ["id", "from_status", "to_status", "note", "actor_user_id", "created_at"]


class OrderNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderNote
        fields = ["id", "kind", "body", "author_user_id", "created_at"]
        read_only_fields = ["id", "author_user_id", "created_at"]


class TicketMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketMessage
        fields = [
            "id",
            "body",
            "author_user_id",
            "author_role",
            "author_email",
            "is_internal",
            "created_at",
        ]
        read_only_fields = ["id", "author_user_id", "author_role", "author_email", "created_at"]
        # is_internal is settable, but only the admin write path
        # (add_admin_message) ever passes it through - the tenant messages
        # action never reads it off request.data, so a tenant can't flag
        # their own message internal even though the field isn't read-only
        # here.


class TicketSerializer(serializers.ModelSerializer):
    # Read-only convenience for list pages (tenant "My tickets", the order
    # tab) that want to show which order a ticket belongs to without a
    # second lookup - None for standalone tickets.
    order_number = serializers.CharField(source="order.order_number", read_only=True, default=None)
    ticket_number = serializers.CharField(read_only=True)

    class Meta:
        model = Ticket
        fields = [
            "id",
            "ticket_number",
            "order",
            "order_number",
            "category",
            "sub_category",
            "description",
            "status",
            "ticket_type",
            "created_by_user_id",
            "created_by_email",
            "resolved_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "ticket_number",
            "status",
            "ticket_type",
            "created_by_user_id",
            "created_by_email",
            "resolved_at",
            "created_at",
        ]

    # Minimum length counts actual characters, not spaces - "  ok   " is
    # still too short. No upper limit.
    DESCRIPTION_MIN_CHARS = 10

    def validate_description(self, value):
        value = (value or "").strip()
        if len("".join(value.split())) < self.DESCRIPTION_MIN_CHARS:
            raise serializers.ValidationError(
                f"Description must be at least {self.DESCRIPTION_MIN_CHARS} characters."
            )
        return value


class AdminTicketSerializer(TicketSerializer):
    """Adds the fields the tenant-side serializer has no use for - the
    admin list spans every organization, so "which org" has to be spelled
    out rather than assumed from request context, and assignment/internal
    handling is admin-only state the tenant never sees."""

    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta(TicketSerializer.Meta):
        fields = TicketSerializer.Meta.fields + [
            "organization_name",
        ]


class OrderTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderTransaction
        fields = ["id", "amount", "method", "status", "reference", "created_at"]
        read_only_fields = ["id", "created_at"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True)
    courier_name = serializers.CharField(source="courier.name", read_only=True, default="")
    # Only meaningful when several stores are in view at once (the super
    # admin's Dispatch Hub) - harmless, if redundant, on every ordinary
    # single-store page, which already knows its own one store.
    store_name = serializers.CharField(source="organization.name", read_only=True, default="")
    cancelled_pct = serializers.SerializerMethodField()
    returned_pct = serializers.SerializerMethodField()
    delivered_pct = serializers.SerializerMethodField()
    acceptance_pct = serializers.SerializerMethodField()
    grand_total = serializers.SerializerMethodField()
    amount_receivable = serializers.SerializerMethodField()
    owed_to_customer = serializers.SerializerMethodField()
    parent_order_number = serializers.CharField(
        source="parent_order.order_number", read_only=True, default=""
    )
    recreated_from_number = serializers.CharField(
        source="recreated_from.order_number", read_only=True, default=""
    )
    # Revert's target - only worked out on the detail view (it's a query
    # per order), null in lists.
    previous_status = serializers.SerializerMethodField()
    # The orders table's ticket symbol - see services.with_ticket_counts.
    ticket_count = serializers.SerializerMethodField()
    open_ticket_count = serializers.SerializerMethodField()
    placed_at = serializers.SerializerMethodField()
    in_transit_days = serializers.SerializerMethodField()
    # Booked from the Dispatch Hub (Order.hub_dispatched_at) - FynkTech
    # ships it, whether or not the store sent it for dispatch. The "by
    # FynkTech" tag. A store's own OMS Courier booking doesn't get it.
    dispatched_by_fynktech = serializers.SerializerMethodField()
    # The Orders card the order sits under and its tag there - see
    # services.workflow_card / workflow_tag.
    workflow_card = serializers.SerializerMethodField()
    workflow_tag = serializers.SerializerMethodField()
    # Every Shipper Advice given on the order, newest first - the order's
    # detail only (null in lists, where it would cost a query per row).
    shipper_advice_history = serializers.SerializerMethodField()
    # Other orders that look like this one placed twice (services.
    # get_duplicate_map) - [] when none; null where the list didn't ask.
    duplicate_of = serializers.SerializerMethodField()
    # Undelivered: is the courier waiting for our Shipper Advice right now,
    # by its own status (services.advice_open_map) - {"open", "courier",
    # "status", "sent"}; null when the courier can't say or the view didn't
    # ask.
    advice_open = serializers.SerializerMethodField()
    # Not Received / Received - Good / Damaged ... (services.receiving_status).
    receiving_status = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "organization_id",
            "store_name",
            "supabase_order_no",
            "order_number",
            "customer_name",
            "customer_phone",
            "customer_email",
            "secondary_phone",
            "address_line1",
            "address_line2",
            "country",
            "postal_code",
            "cnic",
            "customer_tags",
            "tag",
            "cancel_reason",
            "invoice_number",
            "courier_charges",
            "customer_type",
            "expected_delivery_date",
            "preferred_courier",
            "risk_status",
            "price_conversion_rate",
            "order_source",
            "shipping_type",
            "agent_id",
            "status",
            "payment_gateway",
            "payment_status",
            "fulfillment_status",
            "city",
            "city_fix",
            "city_before_fix",
            "city_fix_note",
            "shop",
            "courier",
            "courier_name",
            "tracking_number",
            "courier_status",
            "courier_tag",
            "courier_reason",
            "platform_reference",
            "dispatched_by_fynktech",
            "issue_note",
            "return_reason",
            "shipper_advice",
            "shipper_advice_remarks",
            "shipper_advice_at",
            "shipper_advice_history",
            "duplicate_of",
            "advice_open",
            "total_amount",
            "coupon_discount",
            "extra_discount",
            "gift_card_discount",
            "loyalty_amount",
            "wallet_amount",
            "total_tax",
            "donation_amount",
            "shipping_amount",
            "express_stitching_amount",
            "amount_paid",
            "grand_total",
            "amount_receivable",
            "owed_to_customer",
            "items",
            "cancelled_pct",
            "returned_pct",
            "delivered_pct",
            "acceptance_pct",
            "parent_order",
            "parent_order_number",
            "recreate_type",
            "recreated_from",
            "recreated_from_number",
            "previous_status",
            "ticket_count",
            "open_ticket_count",
            "placed_at",
            "in_transit_days",
            "dispatch_requested_at",
            "dispatched_at",
            "delivered_at",
            "returned_at",
            "return_in_progress_at",
            "return_received_at",
            "return_received_by_email",
            "return_condition",
            "return_breakdown",
            "receiving_status",
            "packed_at",
            "packed_by_email",
            "delivery_attempts",
            "workflow_flag",
            "workflow_card",
            "workflow_tag",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "dispatch_requested_at",
            # Fix Cities' own (oms.city_fixer) - never set through Edit.
            "city_fix",
            "city_before_fix",
            "city_fix_note",
            "id",
            "supabase_order_no",
            "status",
            "total_amount",
            "courier",
            "tracking_number",
            "courier_status",
            "courier_tag",
            "courier_reason",
            "courier_charges",
            "platform_reference",
            "issue_note",
            "return_reason",
            "shipper_advice",
            "shipper_advice_remarks",
            "shipper_advice_at",
            "cancel_reason",
            "parent_order",
            "recreate_type",
            "recreated_from",
            "placed_at",
            "dispatched_at",
            "delivered_at",
            "returned_at",
            "return_in_progress_at",
            "return_received_at",
            "return_received_by_email",
            "return_condition",
            "return_breakdown",
            "packed_at",
            "packed_by_email",
            "delivery_attempts",
            "workflow_flag",
            "created_at",
            "updated_at",
        ]

    def _probability(self, order, key):
        # Populated by OrderViewSet.list()/retrieve() via serializer context
        # - avoids a per-row query by computing once for the whole page.
        prob_map = self.context.get("probability_map") or {}
        entry = prob_map.get(order.customer_phone)
        return entry[key] if entry else None

    def get_dispatched_by_fynktech(self, order):
        # Not once the booking was undone and the order is back before
        # booking (Booking Pending's "Not booked - retry").
        from .services import DISPATCH_REQUESTABLE_STATUSES

        return bool(order.hub_dispatched_at) and order.status not in DISPATCH_REQUESTABLE_STATUSES

    def to_representation(self, order):
        return _show_original_number(order, super().to_representation(order))

    def get_workflow_card(self, order):
        from .services import workflow_card

        return workflow_card(order)

    def get_workflow_tag(self, order):
        from .services import workflow_tag

        return workflow_tag(order)

    def get_duplicate_of(self, order):
        dup_map = self.context.get("duplicate_map")
        if dup_map is None:
            return None
        return dup_map.get(str(order.id), [])

    def get_receiving_status(self, order):
        from . import services

        return services.receiving_status(order)

    def get_advice_open(self, order):
        return (self.context.get("advice_map") or {}).get(str(order.id))

    def get_shipper_advice_history(self, order):
        if not self.context.get("with_advice_history"):
            return None
        from .models import OrderStatusEvent

        events = list(
            OrderStatusEvent.all_objects.filter(order=order, note__startswith="Shipper advice:")
            .order_by("-created_at")
            .values("note", "created_at", "actor_user_id")
        )
        emails = {}
        ids = {str(e["actor_user_id"]) for e in events if e["actor_user_id"]}
        if ids:
            try:
                from core.organization_admin_service import _emails_for_user_ids

                emails = _emails_for_user_ids(list(ids))
            except Exception:  # noqa: BLE001 - names are a nicety
                emails = {}
        out = []
        for e in events:
            # "Shipper advice: Reattempt - call first (sent to Leopards)"
            text = e["note"][len("Shipper advice:"):].strip()
            sent_to = ""
            if text.endswith(")") and " (" in text:
                text, sent_to = text.rsplit(" (", 1)
                sent_to = sent_to[:-1]
            # "(sent to PostEx, auto)" - Auto Shipper Advice (oms.auto_advice).
            auto = sent_to.endswith(", auto")
            if auto:
                sent_to = sent_to[: -len(", auto")]
            advice, _, remarks = text.partition(" - ")
            out.append({
                "advice": advice.strip(),
                "remarks": remarks.strip(),
                "sent_to": sent_to,
                "auto": auto,
                "at": e["created_at"].isoformat(),
                "by": "Auto Shipper Advice" if auto else (
                    emails.get(str(e["actor_user_id"]), "") if e["actor_user_id"] else ""
                ),
            })
        return out

    def get_cancelled_pct(self, order):
        return self._probability(order, "cancelled_pct")

    def get_returned_pct(self, order):
        return self._probability(order, "returned_pct")

    def get_delivered_pct(self, order):
        return self._probability(order, "delivered_pct")

    def get_acceptance_pct(self, order):
        cancelled = self._probability(order, "cancelled_pct")
        return None if cancelled is None else 100 - cancelled

    def get_grand_total(self, order):
        return order.grand_total

    def get_amount_receivable(self, order):
        return order.amount_receivable

    def get_owed_to_customer(self, order):
        return order.owed_to_customer

    def _ticket_counts(self, order):
        # Annotated on every list query (services.with_ticket_counts); a
        # single order serialized on its own (detail, a live update) is
        # counted here instead.
        if hasattr(order, "_ticket_count"):
            return order._ticket_count, order._open_ticket_count
        from .models import Ticket

        tickets = Ticket.all_objects.filter(order_id=order.id)
        return tickets.count(), tickets.exclude(status="resolved").count()

    def get_ticket_count(self, order):
        return self._ticket_counts(order)[0]

    def get_open_ticket_count(self, order):
        return self._ticket_counts(order)[1]

    def get_previous_status(self, order):
        if not self.context.get("with_previous_status"):
            return None
        from .services import previous_status

        return previous_status(order)

    def get_placed_at(self, order):
        return order.placed_at or order.created_at

    def get_in_transit_days(self, order):
        # Only the Critical Orders list carries this (see services.
        # critical_transit_orders, which annotates it) - null everywhere else.
        since = getattr(order, "_in_transit_since", None)
        if since is None:
            return None
        return (timezone.now() - since).days
