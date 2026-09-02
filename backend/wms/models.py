"""WMS models - warehouses, stock items and an append-only movement
ledger - each extending core.models.TenantScopedModel and declared in the
"wms" Postgres schema, following the pattern in oms/models.py."""

import uuid

from django.db import models

from core.models import TenantScopedModel


class Warehouse(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    is_active = models.BooleanField(default=True)
    # Exactly one warehouse per org is the fulfilment default, so order
    # stock checks know where to look without the caller naming it.
    is_default = models.BooleanField(default=False)

    class Meta:
        db_table = '"wms"."warehouses"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"], name="wms_warehouse_code_per_org"
            )
        ]
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.code})"


class StockItem(TenantScopedModel):
    """On-hand quantity of one SKU in one warehouse.

    `quantity` is a plain signed IntegerField, NOT PositiveInteger, on
    purpose: dispatching more units than are on hand is allowed (the user
    is warned and confirms - see wms.services.consume_for_order), and the
    resulting negative balance is the signal the WMS screen surfaces as an
    alert. Clamping at zero here would silently hide that the warehouse
    owes stock it hasn't got.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="stock_items")
    # Matches oms.OrderItem.barcode, which is where the Shopify line-item
    # SKU is stored (see integrations.services.upsert_order_from_shopify).
    # Can be blank - not every Shopify variant has a SKU set, and those are
    # still synced (see integrations.services.sync_inventory_from_shopify)
    # rather than silently dropped, so the sku uniqueness constraint below
    # only applies to non-Shopify-linked rows.
    sku = models.CharField(max_length=100, blank=True, default="")
    product_name = models.CharField(max_length=255, blank=True, default="")
    quantity = models.IntegerField(default=0)
    # Surfaced as a "low stock" warning before it ever reaches zero.
    reorder_level = models.PositiveIntegerField(default=0)
    # Shopify's InventoryItem id - the real join key for stock levels
    # (unlike sku, which can be blank or, in principle, reused). Null for
    # manually-created items and rows seeded by
    # wms.services.import_skus_from_orders that haven't been matched to a
    # Shopify variant yet.
    shopify_inventory_item_id = models.BigIntegerField(null=True, blank=True)

    class Meta:
        db_table = '"wms"."stock_items"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "warehouse", "sku"],
                name="wms_stock_sku_per_warehouse",
                condition=models.Q(shopify_inventory_item_id__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["organization", "warehouse", "shopify_inventory_item_id"],
                name="wms_stock_shopify_item_per_warehouse",
                condition=models.Q(shopify_inventory_item_id__isnull=False),
            ),
        ]
        ordering = ["sku"]

    def __str__(self):
        return f"{self.sku} @ {self.warehouse_id}: {self.quantity}"

    @property
    def is_negative(self):
        return self.quantity < 0

    @property
    def is_low(self):
        return 0 <= self.quantity <= self.reorder_level


class StockMovement(TenantScopedModel):
    """Append-only ledger of every quantity change. Never updated or
    deleted - StockItem.quantity is the running total, this is the audit
    trail explaining how it got there (which order consumed it, which
    return put it back, who adjusted it by hand)."""

    REASON_CHOICES = [
        ("order_dispatch", "Order Dispatch"),
        ("return_restock", "Return Restock"),
        ("manual_adjustment", "Manual Adjustment"),
        ("initial", "Initial Stock"),
        ("shopify_sync", "Shopify Inventory Sync"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stock_item = models.ForeignKey(StockItem, on_delete=models.CASCADE, related_name="movements")
    # Signed: negative consumes stock, positive puts it back.
    delta = models.IntegerField()
    # Balance immediately after this movement - lets the ledger be read
    # without replaying every prior row.
    balance_after = models.IntegerField()
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    # Free-text reference rather than an FK to oms.Order: keeps WMS
    # independent of the OMS schema, and a movement must survive its
    # order being deleted (the stock really did move).
    order_number = models.CharField(max_length=50, blank=True, default="")
    note = models.CharField(max_length=255, blank=True, default="")
    actor_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"wms"."stock_movements"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.stock_item_id} {self.delta:+d} ({self.reason})"
