from django.contrib import admin

from .models import StockItem, StockMovement, Warehouse


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "organization", "is_default", "is_active")
    list_filter = ("is_active", "is_default")
    search_fields = ("name", "code")


@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ("sku", "product_name", "warehouse", "quantity", "reorder_level")
    list_filter = ("warehouse",)
    search_fields = ("sku", "product_name")


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("stock_item", "delta", "balance_after", "reason", "order_number", "created_at")
    list_filter = ("reason",)
    search_fields = ("order_number", "stock_item__sku")
