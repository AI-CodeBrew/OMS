from rest_framework import serializers

from .models import PurchaseOrder, PurchaseOrderLine, StockItem, StockMovement, Supplier, Warehouse
from .services import purchase_order_state


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = [
            "id", "code", "name", "is_active", "is_default",
            "city", "address", "poc_name", "poc_phone", "remark", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
        # Made from the name when left out (WarehouseViewSet.perform_create).
        extra_kwargs = {"code": {"required": False}}


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "phone", "city", "created_at"]
        read_only_fields = ["id", "created_at"]


class PurchaseOrderLineSerializer(serializers.ModelSerializer):
    received = serializers.IntegerField(read_only=True)

    class Meta:
        model = PurchaseOrderLine
        fields = [
            "id", "sku", "product_name", "image_url", "quantity_ordered", "unit_price",
            "good_received", "damaged_received", "received",
        ]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    """Read shape - created through PurchaseOrderViewSet.create, which
    validates the lines in wms.services.create_purchase_order. The totals
    come annotated from the list query."""

    po_number = serializers.CharField(read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    lines = PurchaseOrderLineSerializer(many=True, read_only=True)
    product_count = serializers.SerializerMethodField()
    total_quantity = serializers.SerializerMethodField()
    received_quantity = serializers.SerializerMethodField()
    good_quantity = serializers.SerializerMethodField()
    damaged_quantity = serializers.SerializerMethodField()
    total_cost = serializers.SerializerMethodField()
    state = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "po_number", "supplier", "supplier_name", "warehouse", "warehouse_name",
            "ordered_at", "note", "lines", "product_count", "total_quantity", "received_quantity",
            "good_quantity", "damaged_quantity", "total_cost", "state", "created_at",
        ]

    def _lines(self, po):
        return list(po.lines.all())

    def get_product_count(self, po):
        return len(self._lines(po))

    def get_total_quantity(self, po):
        return sum(line.quantity_ordered for line in self._lines(po))

    def get_good_quantity(self, po):
        return sum(line.good_received for line in self._lines(po))

    def get_damaged_quantity(self, po):
        return sum(line.damaged_received for line in self._lines(po))

    def get_received_quantity(self, po):
        return self.get_good_quantity(po) + self.get_damaged_quantity(po)

    def get_total_cost(self, po):
        return str(sum(line.unit_price * line.quantity_ordered for line in self._lines(po)))

    def get_state(self, po):
        return purchase_order_state(self.get_total_quantity(po), self.get_received_quantity(po))


class StockItemSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True, default="")
    # Computed on the model (see StockItem.is_negative/is_low) rather than
    # re-derived in the frontend, so "what counts as an alert" has one
    # definition shared by every consumer.
    is_negative = serializers.BooleanField(read_only=True)
    is_low = serializers.BooleanField(read_only=True)
    shopify_linked = serializers.SerializerMethodField()
    has_pending_shopify_push = serializers.BooleanField(read_only=True)

    class Meta:
        model = StockItem
        fields = [
            "id",
            "warehouse",
            "warehouse_name",
            "sku",
            "product_name",
            "image_url",
            "quantity",
            "reorder_level",
            "is_negative",
            "is_low",
            "shopify_linked",
            "has_pending_shopify_push",
            "pending_shopify_delta",
            "pending_shopify_name",
            "previous_shopify_name",
            "shopify_push_error",
            "last_pushed_to_shopify_at",
            "updated_at",
        ]
        # Push-tracking fields are written only by wms.services (adjust/
        # rename) and the push itself, never directly by a client.
        read_only_fields = [
            "id",
            "pending_shopify_delta",
            "pending_shopify_name",
            "previous_shopify_name",
            "shopify_push_error",
            "last_pushed_to_shopify_at",
            "updated_at",
        ]

    def get_shopify_linked(self, obj):
        return obj.shopify_inventory_item_id is not None


class StockMovementSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source="stock_item.sku", read_only=True, default="")
    product_name = serializers.CharField(source="stock_item.product_name", read_only=True, default="")
    reason_display = serializers.CharField(source="get_reason_display", read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            "id",
            "stock_item",
            "sku",
            "product_name",
            "delta",
            "balance_after",
            "reason",
            "reason_display",
            "order_number",
            "note",
            "created_at",
        ]
