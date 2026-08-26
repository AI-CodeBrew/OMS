from rest_framework import serializers

from .models import StockItem, StockMovement, Warehouse


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ["id", "code", "name", "is_active", "is_default", "created_at"]
        read_only_fields = ["id", "created_at"]


class StockItemSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True, default="")
    # Computed on the model (see StockItem.is_negative/is_low) rather than
    # re-derived in the frontend, so "what counts as an alert" has one
    # definition shared by every consumer.
    is_negative = serializers.BooleanField(read_only=True)
    is_low = serializers.BooleanField(read_only=True)

    class Meta:
        model = StockItem
        fields = [
            "id",
            "warehouse",
            "warehouse_name",
            "sku",
            "product_name",
            "quantity",
            "reorder_level",
            "is_negative",
            "is_low",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]


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
