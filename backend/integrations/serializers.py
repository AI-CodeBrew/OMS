from rest_framework import serializers

from .models import ShopifyConnection


class ShopifyConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopifyConnection
        # access_token / webhook_secret are write-only inputs on connect
        # (see ShopifyConnectionView.post) - never echoed back.
        fields = ["shop_domain", "currency", "is_connected", "last_synced_at", "created_at"]
