from django.contrib import admin

from .models import ShopifyConnection, ShopifySyncJob, SmartlaneConnection


@admin.register(ShopifyConnection)
class ShopifyConnectionAdmin(admin.ModelAdmin):
    list_display = ("shop_domain", "shop_name", "organization", "is_connected", "last_synced_at")
    list_filter = ("is_connected", "auto_sync_orders", "webhooks_active")
    search_fields = ("shop_domain", "shop_name")


@admin.register(SmartlaneConnection)
class SmartlaneConnectionAdmin(admin.ModelAdmin):
    list_display = ("organization", "is_connected", "webhooks_active", "events_received_count", "last_event_at")
    list_filter = ("is_connected", "webhooks_active")


@admin.register(ShopifySyncJob)
class ShopifySyncJobAdmin(admin.ModelAdmin):
    list_display = ("organization", "mode", "status", "pages_fetched", "total_fetched", "created_at")
    list_filter = ("status", "mode")
