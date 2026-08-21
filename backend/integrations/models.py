from django.db import models

from core.models import TenantScopedModel


class ShopifyConnection(TenantScopedModel):
    """One Shopify store per organization. access_token/webhook_secret are
    stored plaintext for now, matching the legacy public.shopify_integrations
    table this replaces - worth hardening (field-level encryption) before
    onboarding real external tenants, same caveat as that legacy table."""

    shop_domain = models.CharField(max_length=255, unique=True)
    access_token = models.CharField(max_length=255)
    webhook_secret = models.CharField(max_length=255)
    currency = models.CharField(max_length=10, blank=True, default="")
    is_connected = models.BooleanField(default=False)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = '"integrations"."shopify_connections"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization"], name="integrations_one_shopify_connection_per_org"
            )
        ]

    def __str__(self):
        return self.shop_domain
