from rest_framework import serializers

from .models import ShopifyConnection, ShopifySyncJob, SmartlaneConnection


class ShopifyConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopifyConnection
        # access_token / webhook_secret are write-only inputs on connect
        # (see ShopifyConnectionView.post) - never echoed back.
        fields = [
            "shop_domain",
            "shop_name",
            "currency",
            "is_connected",
            "auto_sync_orders",
            "webhooks_active",
            "last_synced_at",
            "created_at",
        ]


class SmartlaneConnectionSerializer(serializers.ModelSerializer):
    webhook_url = serializers.SerializerMethodField()
    # Smartlane has no self-service webhook-registration API (unlike
    # Shopify's register_webhook/unregister_webhook), so there is nothing
    # to verify a registration against - the only honest signal that the
    # webhook is actually live is that Smartlane has called it at least
    # once. Overrides the stored model field, which used to be hardcoded
    # true on connect regardless of whether the URL was ever pasted
    # anywhere.
    webhooks_active = serializers.SerializerMethodField()

    class Meta:
        model = SmartlaneConnection
        # api_key / webhook_secret are write-only inputs on connect (see
        # SmartlaneConnectionView.post) - never echoed back.
        fields = [
            "is_connected",
            "webhooks_active",
            "webhook_url",
            "store_warehouse_code",
            "last_event_at",
            "events_received_count",
            "created_at",
        ]

    def get_webhook_url(self, connection):
        request = self.context.get("request")
        path = f"/api/integrations/smartlane/webhook/{connection.webhook_token}/"
        return request.build_absolute_uri(path) if request else path

    def get_webhooks_active(self, connection):
        return bool(connection.events_received_count)


class ShopifySyncJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopifySyncJob
        fields = [
            "id",
            "status",
            "mode",
            "range_from",
            "range_to",
            "pages_fetched",
            "total_fetched",
            "total_available",
            "created_count",
            "updated_count",
            "skipped_count",
            "error_message",
            "started_at",
            "finished_at",
            "created_at",
        ]
