from rest_framework import serializers

from .models import Courier, Order, OrderItem, OrderNote, OrderStatusEvent, OrderTransaction


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


class OrderTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderTransaction
        fields = ["id", "amount", "method", "status", "reference", "created_at"]
        read_only_fields = ["id", "created_at"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True)
    courier_name = serializers.CharField(source="courier.name", read_only=True, default="")
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
    placed_at = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
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
            "placed_at",
            "dispatched_at",
            "delivered_at",
            "returned_at",
            "return_received_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "total_amount",
            "courier",
            "tracking_number",
            "issue_note",
            "return_reason",
            "parent_order",
            "placed_at",
            "dispatched_at",
            "delivered_at",
            "returned_at",
            "return_received_at",
            "created_at",
            "updated_at",
        ]

    def _probability(self, order, key):
        # Populated by OrderViewSet.list()/retrieve() via serializer context
        # - avoids a per-row query by computing once for the whole page.
        prob_map = self.context.get("probability_map") or {}
        entry = prob_map.get(order.customer_phone)
        return entry[key] if entry else None

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

    def get_placed_at(self, order):
        return order.placed_at or order.created_at
