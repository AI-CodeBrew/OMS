from rest_framework import serializers

from .models import WEBHOOK_HEADER_KEY, LeopardsConnection, LeopardsSyncJob


class LeopardsConnectionSerializer(serializers.ModelSerializer):
    # The three values the merchant registers with Leopards' Push API (its
    # callback URL and the custom request header it should send). Only ever
    # served by the IsOrgAdmin-only connection view.
    webhook_url = serializers.SerializerMethodField()
    webhook_header_key = serializers.SerializerMethodField()
    webhook_header_value = serializers.CharField(source="webhook_secret", read_only=True)
    # The only honest signal that the registration with Leopards is done is
    # that Leopards has actually called - same reasoning as PostEx's.
    webhooks_active = serializers.SerializerMethodField()

    class Meta:
        model = LeopardsConnection
        # api_key / api_password are write-only inputs on connect (see
        # LeopardsConnectionView.post) - never echoed back.
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
            "shipper_name",
            "origin_city_id",
            "origin_city_name",
            "default_weight_grams",
            "default_shipment_type",
            "default_notes",
            "load_sheet_courier_name",
            "load_sheet_courier_code",
            "city_aliases",
            "last_synced_at",
            "created_at",
        ]

    def get_webhook_url(self, connection):
        request = self.context.get("request")
        path = f"/api/integrations/leopards/webhook/{connection.webhook_token}/"
        return request.build_absolute_uri(path) if request else path

    def get_webhook_header_key(self, connection):
        return WEBHOOK_HEADER_KEY

    def get_webhooks_active(self, connection):
        return bool(connection.events_received_count)


class LeopardsStatusSerializer(serializers.Serializer):
    """Minimal shape for GET .../status/ - readable by any oms staff, so the
    orders page can show/hide the Leopards actions without IsOrgAdmin."""

    connected = serializers.BooleanField()
    ready_to_book = serializers.BooleanField()
    # Leopards through OMS Courier: FynkTech's own account, from the store's
    # approved shipper on it (see services.store_shipper).
    oms_connected = serializers.BooleanField(default=False)


class LeopardsSyncJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeopardsSyncJob
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
