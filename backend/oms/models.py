import uuid

from django.db import models

from core.models import TenantScopedModel


class Order(TenantScopedModel):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("confirmed", "Confirmed"),
        ("cancelled", "Cancelled"),
        ("fulfilled", "Fulfilled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=50)
    customer_name = models.CharField(max_length=255)
    customer_phone = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Set only for orders synced from Shopify - lets webhook/sync upsert
    # idempotently instead of creating duplicates on redelivery.
    shopify_order_id = models.BigIntegerField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."orders"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "order_number"], name="oms_order_number_per_org"
            ),
            models.UniqueConstraint(
                fields=["organization", "shopify_order_id"],
                name="oms_shopify_order_id_per_org",
                condition=models.Q(shopify_order_id__isnull=False),
            ),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return self.order_number


class OrderItem(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product_name = models.CharField(max_length=255)
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = '"oms"."order_items"'

    def __str__(self):
        return f"{self.product_name} x{self.quantity}"
