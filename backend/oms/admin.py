from django.contrib import admin

from .models import Order, OrderItem


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
        "total_amount",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("order_number", "customer_name")
    inlines = [OrderItemInline]
