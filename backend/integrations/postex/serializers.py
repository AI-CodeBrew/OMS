from rest_framework import serializers

from .models import WEBHOOK_HEADER_KEY, PostExConnection, PostExSyncJob


class PostExConnectionSerializer(serializers.ModelSerializer):
    # The three values the merchant pastes into PostEx's portal (API
    # Integration Guide page -> Webhook Configuration). Only ever served by the
    # IsOrgAdmin-only connection view.
    webhook_url = serializers.SerializerMethodField()
    webhook_header_key = serializers.SerializerMethodField()
    webhook_header_value = serializers.CharField(source="webhook_secret", read_only=True)
    # The only honest signal that the portal side is set up is that PostEx
    # has actually called - same reasoning as BarqRaftar's.
    webhooks_active = serializers.SerializerMethodField()

    class Meta:
        model = PostExConnection
        # api_token is a write-only input on connect (see
        # PostExConnectionView.post) - never echoed back.
        fields = [
            "webhook_url",
            "webhook_header_key",
            "webhook_header_value",
            "webhooks_active",
            "events_received_count",
            "last_event_at",
            "last_webhook_error",
            "last_webhook_error_at",
            "is_connected",
            "merchant_name",
            "pickup_address_code",
            "pickup_address_label",
            "pickup_city_name",
            "default_order_type",
            "default_notes",
            "city_aliases",
            "last_synced_at",
            "created_at",
        ]

    def get_webhook_url(self, connection):
        request = self.context.get("request")
        path = f"/api/integrations/postex/webhook/{connection.webhook_token}/"
        return request.build_absolute_uri(path) if request else path

    def get_webhook_header_key(self, connection):
        return WEBHOOK_HEADER_KEY

    def get_webhooks_active(self, connection):
        return bool(connection.events_received_count)


class PostExStatusSerializer(serializers.Serializer):
    """Minimal shape for GET .../status/ - readable by any oms staff, so the
    orders page can show/hide the PostEx actions without IsOrgAdmin."""

    connected = serializers.BooleanField()
    ready_to_book = serializers.BooleanField()


class PostExSyncJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostExSyncJob
        fields = [
            "id",
            "status",
            "checked_count",
            "updated_count",
            "total_available",
            "error_message",
            "started_at",
            "finished_at",
            "created_at",
        ]
