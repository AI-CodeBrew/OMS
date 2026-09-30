from rest_framework import serializers

from .models import BarqRaftarConnection, BarqRaftarSyncJob


class BarqRaftarConnectionSerializer(serializers.ModelSerializer):
    webhook_url = serializers.SerializerMethodField()
    # BarqRaftar has no self-service webhook-registration API (the URL has
    # to be sent to support@barqraftar.pk by hand) - same "the only honest
    # signal is that it's actually been called" reasoning as Smartlane's
    # own SmartlaneConnectionSerializer.get_webhooks_active.
    webhooks_active = serializers.SerializerMethodField()

    class Meta:
        model = BarqRaftarConnection
        # api_key / api_secret are write-only inputs on connect (see
        # BarqRaftarConnectionView.post) - never echoed back.
        fields = [
            "is_connected",
            "webhooks_active",
            "webhook_url",
            "pickup_address_id",
            "pickup_address_label",
            "from_city_id",
            "from_city_name",
            "default_weight_grams",
            "label_format",
            "city_aliases",
            "last_event_at",
            "events_received_count",
            "created_at",
        ]

    def get_webhook_url(self, connection):
        request = self.context.get("request")
        path = f"/api/integrations/barqraftar/webhook/{connection.webhook_token}/"
        return request.build_absolute_uri(path) if request else path

    def get_webhooks_active(self, connection):
        return bool(connection.events_received_count)


class BarqRaftarStatusSerializer(serializers.Serializer):
    """Minimal shape for GET .../status/ - the endpoint non-admin oms staff
    can read (see barqraftar/views.py's BarqRaftarStatusView), so the
    orders page can show/hide the BarqRaftar actions without needing
    IsOrgAdmin."""

    connected = serializers.BooleanField()
    ready_to_book = serializers.BooleanField()


class BarqRaftarSyncJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = BarqRaftarSyncJob
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
