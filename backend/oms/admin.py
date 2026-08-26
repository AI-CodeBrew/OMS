from django.contrib import admin

from .models import Courier, Order, OrderItem, OrderNote, OrderStatusEvent, OrderTransaction


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "order_number",
        "organization",
        "customer_name",
        "status",
        "payment_gateway",
        "payment_status",
        "courier",
        "total_amount",
        "created_at",
    )
    list_filter = ("status", "payment_gateway", "payment_status", "fulfillment_status")
    search_fields = ("order_number", "customer_name", "customer_phone")
    inlines = [OrderItemInline]


@admin.register(Courier)
class CourierAdmin(admin.ModelAdmin):
    list_display = ("name", "organization", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)


@admin.register(OrderStatusEvent)
class OrderStatusEventAdmin(admin.ModelAdmin):
    list_display = ("order", "from_status", "to_status", "actor_user_id", "created_at")
    list_filter = ("from_status", "to_status")
    search_fields = ("order__order_number",)


@admin.register(OrderNote)
class OrderNoteAdmin(admin.ModelAdmin):
    list_display = ("order", "kind", "author_user_id", "created_at")
    list_filter = ("kind",)
    search_fields = ("order__order_number", "body")


@admin.register(OrderTransaction)
class OrderTransactionAdmin(admin.ModelAdmin):
    list_display = ("order", "amount", "method", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("order__order_number", "reference")
