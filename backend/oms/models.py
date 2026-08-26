import uuid

from django.db import models

from core.models import TenantScopedModel


class Courier(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = '"oms"."couriers"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="oms_courier_name_per_org"
            )
        ]
        ordering = ["name"]

    def __str__(self):
        return self.name


class Order(TenantScopedModel):
    STATUS_CHOICES = [
        # Entry state for every synced/imported order - "nobody has looked
        # at this yet". CS moves it into Pending CC/COD (see
        # services.acknowledge_order) once they start working it, which is
        # what separates "untouched inbox" from "in progress with the
        # customer".
        ("new", "New"),
        ("pending_cc", "Pending CC"),
        ("pending_cod", "Pending COD"),
        ("city_issue", "City Issue"),
        ("awaiting_assigning", "Awaiting Assigning"),
        ("awaiting_approval", "Awaiting Approval"),
        ("approved", "Approved"),
        # Reached directly from awaiting_assigning when a courier booking is
        # pushed to Smartlane (see services.push_order_to_smartlane) -
        # parallel to, not a replacement for, the manual approve/dispatch
        # path above.
        ("ready_to_print", "Ready to Print"),
        ("ready_to_pick", "Ready to Pick"),
        ("dispatch_issue", "Dispatch Issue"),
        ("awaiting_dispatched", "Awaiting Dispatched"),
        ("dispatched", "Dispatched"),
        ("delivered", "Delivered"),
        ("cancelled", "Cancelled"),
        ("returned", "Returned"),
    ]
    GATEWAY_CHOICES = [
        ("cc", "CC"),
        ("cod", "COD"),
    ]
    PAYMENT_STATUS_CHOICES = [
        ("pending", "Pending"),
        ("paid", "Paid"),
    ]
    FULFILLMENT_STATUS_CHOICES = [
        ("unfulfilled", "Unfulfilled"),
        ("fulfilled", "Fulfilled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=50)
    customer_name = models.CharField(max_length=255)
    customer_phone = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="pending_cod")
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Set only for orders synced from Shopify - lets webhook/sync upsert
    # idempotently instead of creating duplicates on redelivery.
    shopify_order_id = models.BigIntegerField(null=True, blank=True)

    payment_gateway = models.CharField(max_length=10, choices=GATEWAY_CHOICES, default="cod")
    # Independent of `status` - a COD order can be Approved/Dispatched while
    # still Pending here until cash is actually collected on delivery.
    payment_status = models.CharField(
        max_length=10, choices=PAYMENT_STATUS_CHOICES, default="pending"
    )
    # Independent of `status` too - mirrors Shopify's own fulfillment_status,
    # not the internal dispatch pipeline.
    fulfillment_status = models.CharField(
        max_length=15, choices=FULFILLMENT_STATUS_CHOICES, default="unfulfilled"
    )

    city = models.CharField(max_length=100, blank=True, default="")
    # Denormalized label (ShopifyConnection.shop_domain for synced orders,
    # "Manual" for manually-created ones) - no multi-shop-per-org model yet.
    shop = models.CharField(max_length=150, blank=True, default="")

    courier = models.ForeignKey(
        Courier, on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    tracking_number = models.CharField(max_length=100, blank=True, default="")
    issue_note = models.CharField(max_length=255, blank=True, default="")
    return_reason = models.CharField(max_length=255, blank=True, default="")

    # When the order was actually placed (Shopify's order created_at for
    # synced orders). Distinct from `created_at` (TenantScopedModel's
    # auto_now_add), which is when this row was written here - those two
    # can differ by however long the order sat in Shopify before a sync
    # pulled it in. Null for manually-created orders; falls back to
    # `created_at` for display (see OrderSerializer.get_placed_at).
    placed_at = models.DateTimeField(null=True, blank=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    # When the courier reported the parcel as coming back.
    returned_at = models.DateTimeField(null=True, blank=True)
    # When the warehouse physically received and scanned it back in - a
    # separate, later event to returned_at, and the gap between the two is
    # exactly the "returned by courier but not yet in our hands" queue the
    # returns desk works from. Set by wms.services.restock_from_return.
    return_received_at = models.DateTimeField(null=True, blank=True)
    return_received_by = models.UUIDField(null=True, blank=True)

    # --- Customer/shipping profile (denormalized on Order, same convention
    # as customer_name/customer_phone - a real cross-order Customer model is
    # out of scope for now) ---
    customer_email = models.CharField(max_length=255, blank=True, default="")
    secondary_phone = models.CharField(max_length=50, blank=True, default="")
    address_line1 = models.CharField(max_length=255, blank=True, default="")
    address_line2 = models.CharField(max_length=255, blank=True, default="")
    country = models.CharField(max_length=100, blank=True, default="")
    postal_code = models.CharField(max_length=50, blank=True, default="")
    cnic = models.CharField(max_length=30, blank=True, default="")
    customer_tags = models.CharField(max_length=255, blank=True, default="")
    customer_type = models.CharField(max_length=50, blank=True, default="")
    expected_delivery_date = models.DateField(null=True, blank=True)
    # Free text, distinct from `courier` (this order's assigned courier) -
    # a customer-level preference, not an order-level assignment.
    preferred_courier = models.CharField(max_length=150, blank=True, default="")
    # Manually set - no risk-scoring logic exists to derive this.
    risk_status = models.CharField(max_length=50, blank=True, default="")
    price_conversion_rate = models.DecimalField(max_digits=10, decimal_places=4, default=1)
    order_source = models.CharField(max_length=50, blank=True, default="")
    shipping_type = models.CharField(max_length=50, blank=True, default="")
    agent_id = models.CharField(max_length=50, blank=True, default="")

    # --- Money breakdown. Grand total / amount receivable / owed-to-customer
    # are computed (see serializers.py), not stored, to avoid drift with
    # total_amount (treated as Subtotal - the sum of line items). ---
    coupon_discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    gift_card_discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    loyalty_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    wallet_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_tax = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    donation_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    shipping_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    express_stitching_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    parent_order = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="split_orders"
    )

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

    @property
    def grand_total(self):
        return (
            self.total_amount
            - self.coupon_discount
            - self.gift_card_discount
            - self.loyalty_amount
            - self.wallet_amount
            + self.total_tax
            + self.donation_amount
            + self.shipping_amount
            + self.express_stitching_amount
        )

    @property
    def amount_receivable(self):
        return max(self.grand_total - self.amount_paid, 0)

    @property
    def owed_to_customer(self):
        return max(self.amount_paid - self.grand_total, 0)


class OrderItem(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product_name = models.CharField(max_length=255)
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    vendor = models.CharField(max_length=150, blank=True, default="")
    barcode = models.CharField(max_length=100, blank=True, default="")
    compare_at_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    weight_grams = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."order_items"'

    def __str__(self):
        return f"{self.product_name} x{self.quantity}"


class OrderStatusEvent(TenantScopedModel):
    """Generic audit trail for every Order.status transition. One shared
    table instead of per-type Dispatch/Return models - core.events.publish_event
    is in-process/ephemeral, so this is the only persisted history."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="status_events")
    from_status = models.CharField(max_length=30)
    to_status = models.CharField(max_length=30)
    note = models.CharField(max_length=255, blank=True, default="")
    # Supabase auth.users.id - same non-FK pattern as core.Membership.user_id.
    actor_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."order_status_events"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.order_id}: {self.from_status} -> {self.to_status}"


class OrderNote(TenantScopedModel):
    """Backs three tabs (Notes / Comments / Custom Message) with one table -
    they're all just timestamped text against an order, differing only in
    `kind`."""

    KIND_CHOICES = [
        ("note", "Note"),
        ("comment", "Comment"),
        ("custom_message", "Custom Message"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="notes")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="note")
    body = models.TextField()
    # Supabase auth.users.id - same non-FK pattern as core.Membership.user_id.
    author_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."order_notes"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()} on {self.order_id}"


class OrderTransaction(TenantScopedModel):
    """Manually-logged payment record - no real payment-gateway integration
    exists yet, so this isn't a live transaction feed."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("success", "Success"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="transactions")
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    method = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    reference = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        db_table = '"oms"."order_transactions"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.amount} ({self.status}) on {self.order_id}"
