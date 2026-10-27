"""WMS models - warehouses, stock items and an append-only movement
ledger - each extending core.models.TenantScopedModel and declared in the
"wms" Postgres schema, following the pattern in oms/models.py."""

import uuid

from django.db import models
from django.db.models.expressions import RawSQL

from core.models import TenantScopedModel


class Warehouse(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    is_active = models.BooleanField(default=True)
    # Exactly one warehouse per org is the fulfilment default, so order
    # stock checks know where to look without the caller naming it.
    is_default = models.BooleanField(default=False)
    # Where it is and who runs it - the Purchase Orders page's Add Warehouse.
    city = models.CharField(max_length=100, blank=True, default="", db_default="")
    address = models.CharField(max_length=255, blank=True, default="", db_default="")
    poc_name = models.CharField(max_length=150, blank=True, default="", db_default="")
    poc_phone = models.CharField(max_length=50, blank=True, default="", db_default="")
    remark = models.CharField(max_length=255, blank=True, default="", db_default="")

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
    # The Shopify product's first image - filled by the Purchase Orders
    # page's Sync from Shopify (integrations.services.
    # sync_product_images_from_shopify), shown when adding a PO.
    image_url = models.URLField(max_length=1000, blank=True, default="", db_default="")

    # Local edits waiting for "Push to Shopify" (see integrations.services.
    # push_stock_changes_to_shopify). Stock is tracked as the net of unpushed
    # manual adjustments, not an absolute target: Shopify deducts its own
    # orders as they're placed, so pushing our absolute count would undo
    # those. Only tracked for Shopify-linked rows.
    # db_default as well as default: the columns get a real database
    # default, so code from before these fields (still running mid-deploy)
    # can keep inserting rows without them.
    pending_shopify_delta = models.IntegerField(default=0, db_default=0)
    # The rename to push ("" = none) and the name it replaces, kept for the
    # confirmation summary's "from -> to".
    pending_shopify_name = models.CharField(max_length=255, blank=True, default="", db_default="")
    previous_shopify_name = models.CharField(max_length=255, blank=True, default="", db_default="")
    # Claimed while a push is sending this row, so a double click or a
    # second tab can't send the same delta twice. A stale claim (a request
    # that died mid-push) expires - see integrations.services.PUSH_CLAIM_TIMEOUT.
    shopify_push_started_at = models.DateTimeField(null=True, blank=True)
    shopify_push_error = models.CharField(max_length=500, blank=True, default="", db_default="")
    last_pushed_to_shopify_at = models.DateTimeField(null=True, blank=True)

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

    @property
    def has_pending_shopify_push(self):
        return bool(self.pending_shopify_delta or self.pending_shopify_name)


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
        ("purchase_receipt", "Purchase Receipt"),
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


class Supplier(TenantScopedModel):
    """Who a purchase order is bought from."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    phone = models.CharField(max_length=50, blank=True, default="")
    city = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        db_table = '"wms"."suppliers"'
        ordering = ["name"]

    def __str__(self):
        return self.name


class PurchaseOrder(TenantScopedModel):
    """Stock bought from a supplier into one warehouse. Its lines say what
    was ordered and how much has arrived (good + damaged); whether it's
    Received, Partially Received or Not Received is worked out from those
    (wms.services.purchase_order_state), never stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Human-facing id ("PO-000123"), same sequence-backed pattern as
    # oms.DispatchBatch.number.
    number = models.BigIntegerField(
        unique=True, editable=False, db_default=RawSQL("nextval('wms.purchase_orders_number_seq')", [])
    )
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="purchase_orders")
    # When it was ordered - filled with the time it was added, editable.
    ordered_at = models.DateTimeField()
    note = models.CharField(max_length=255, blank=True, default="")
    created_by_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"wms"."purchase_orders"'
        ordering = ["-ordered_at"]

    def __str__(self):
        return self.po_number

    @property
    def po_number(self):
        return f"PO-{self.number:06d}" if self.number else ""


class PurchaseOrderLine(TenantScopedModel):
    """One SKU on a purchase order. good_received units are in stock
    (each receipt adds them - see wms.services.receive_purchase_order);
    damaged_received units arrived but were never added."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    sku = models.CharField(max_length=100)
    product_name = models.CharField(max_length=255, blank=True, default="")
    image_url = models.URLField(max_length=1000, blank=True, default="")
    quantity_ordered = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    good_received = models.PositiveIntegerField(default=0)
    damaged_received = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = '"wms"."purchase_order_lines"'
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.sku} x{self.quantity_ordered}"

    @property
    def received(self):
        return self.good_received + self.damaged_received
