from rest_framework import serializers

from .models import PostExConnection, PostExSyncJob


class PostExConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostExConnection
        # api_token is a write-only input on connect (see
        # PostExConnectionView.post) - never echoed back.
        fields = [
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
