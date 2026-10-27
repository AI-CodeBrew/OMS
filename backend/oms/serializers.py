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
    class Meta:
        model = DispatchBatchOrder
        fields = ["id", "order_id", "order_number", "removed_at"]


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
            "compare_at_price",
            "discount_amount",
            "weight_grams",
        ]
        read_only_fields = ["id"]


class CourierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Courier
        fields = ["id", "name", "is_active"]
        read_only_fields = ["id"]


class OrderSummarySerializer(serializers.ModelSerializer):
    """Lightweight - used for Split Orders / Customer History tabs, which
    only need to list sibling orders, not their full detail."""

    class Meta:
        model = Order
        fields = ["id", "order_number", "status", "total_amount", "created_at"]


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
            "shop",
            "courier",
            "courier_name",
            "tracking_number",
            "courier_status",
            "platform_reference",
            "dispatched_by_fynktech",
            "issue_note",
            "return_reason",
            "total_amount",
            "coupon_discount",
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
            "id",
            "supabase_order_no",
            "status",
            "total_amount",
            "courier",
            "tracking_number",
            "courier_status",
            "courier_charges",
            "platform_reference",
            "issue_note",
            "return_reason",
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

    def get_workflow_card(self, order):
        from .services import workflow_card

        return workflow_card(order)

    def get_workflow_tag(self, order):
        from .services import workflow_tag

        return workflow_tag(order)

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
