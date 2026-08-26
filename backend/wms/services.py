"""WMS business logic. Kept out of views (same convention as
oms/services.py) so OMS can call straight into it - the stock check that
gates Ready to Print lives here, not in an HTTP handler."""

from django.db import transaction

from .models import StockItem, StockMovement, Warehouse


class InsufficientStock(Exception):
    """Raised when an order needs more units than are on hand and the
    caller did not pass force=True. Carries the per-SKU shortage detail so
    the UI can show exactly what is short, not just that something is."""

    def __init__(self, shortages):
        self.shortages = shortages
        summary = ", ".join(
            f"{s['sku'] or s['product_name']} (need {s['required']}, have {s['available']})"
            for s in shortages
        )
        super().__init__(f"Insufficient stock: {summary}")


def get_default_warehouse(organization_id):
    """The warehouse order fulfilment draws from. Falls back to any active
    warehouse when none is explicitly flagged default, so a single-warehouse
    org works without configuring anything."""
    return (
        Warehouse.objects.filter(organization_id=organization_id, is_active=True, is_default=True).first()
        or Warehouse.objects.filter(organization_id=organization_id, is_active=True).first()
    )


def _order_line_requirements(order):
    """Collapses an order's line items to {sku: {qty, name}}.

    Items are keyed by SKU (oms.OrderItem.barcode - where the Shopify
    line-item SKU is stored). Items with no SKU can't be matched to stock
    at all, so they're reported separately rather than silently ignored.
    """
    required = {}
    unmatched = []
    for item in order.items.all():
        sku = (item.barcode or "").strip()
        if not sku:
            unmatched.append(item.product_name)
            continue
        entry = required.setdefault(sku, {"quantity": 0, "product_name": item.product_name})
        entry["quantity"] += item.quantity
    return required, unmatched


def check_order_stock(order, warehouse=None):
    """Read-only availability check. Returns a list of shortage dicts -
    empty means everything is in stock. Never mutates anything, so the UI
    can call it to preview before committing."""
    warehouse = warehouse or get_default_warehouse(order.organization_id)
    if warehouse is None:
        return []

    required, _unmatched = _order_line_requirements(order)
    if not required:
        return []

    on_hand = {
        item.sku: item
        for item in StockItem.objects.filter(
            organization_id=order.organization_id, warehouse=warehouse, sku__in=required.keys()
        )
    }

    shortages = []
    for sku, need in required.items():
        item = on_hand.get(sku)
        available = item.quantity if item else 0
        if available < need["quantity"]:
            shortages.append(
                {
                    "sku": sku,
                    "product_name": need["product_name"],
                    "required": need["quantity"],
                    "available": available,
                    "short_by": need["quantity"] - available,
                }
            )
    return shortages


@transaction.atomic
def consume_for_order(order, *, force=False, actor_user_id=None, warehouse=None):
    """Deducts an order's line items from stock and writes the ledger.

    Raises InsufficientStock unless force=True. With force, the deduction
    still happens and quantities are allowed to go negative - that negative
    balance is deliberately visible on the WMS screen as an alert rather
    than being clamped away (see StockItem.quantity's comment).
    """
    warehouse = warehouse or get_default_warehouse(order.organization_id)
    if warehouse is None:
        # No warehouse configured yet - stock control isn't in use, so
        # don't block order flow on it.
        return []

    shortages = check_order_stock(order, warehouse=warehouse)
    if shortages and not force:
        raise InsufficientStock(shortages)

    required, _unmatched = _order_line_requirements(order)
    movements = []
    for sku, need in required.items():
        item, _ = StockItem.objects.get_or_create(
            organization_id=order.organization_id,
            warehouse=warehouse,
            sku=sku,
            defaults={"product_name": need["product_name"]},
        )
        item.quantity -= need["quantity"]
        item.save(update_fields=["quantity", "updated_at"])
        movements.append(
            StockMovement.objects.create(
                organization_id=order.organization_id,
                stock_item=item,
                delta=-need["quantity"],
                balance_after=item.quantity,
                reason="order_dispatch",
                order_number=order.order_number,
                actor_user_id=actor_user_id,
            )
        )
    return movements


@transaction.atomic
def restock_from_return(order, *, actor_user_id=None, warehouse=None, note=""):
    """Puts a returned order's units back into stock. Idempotent per
    order: if this order was already restocked, returns [] instead of
    double-counting, since a returns desk scanning the same parcel twice
    is an expected mistake, not an exceptional one."""
    warehouse = warehouse or get_default_warehouse(order.organization_id)
    if warehouse is None:
        return []

    already = StockMovement.objects.filter(
        organization_id=order.organization_id,
        order_number=order.order_number,
        reason="return_restock",
    ).exists()
    if already:
        return []

    required, _unmatched = _order_line_requirements(order)
    movements = []
    for sku, need in required.items():
        item, _ = StockItem.objects.get_or_create(
            organization_id=order.organization_id,
            warehouse=warehouse,
            sku=sku,
            defaults={"product_name": need["product_name"]},
        )
        item.quantity += need["quantity"]
        item.save(update_fields=["quantity", "updated_at"])
        movements.append(
            StockMovement.objects.create(
                organization_id=order.organization_id,
                stock_item=item,
                delta=need["quantity"],
                balance_after=item.quantity,
                reason="return_restock",
                order_number=order.order_number,
                note=note,
                actor_user_id=actor_user_id,
            )
        )
    return movements


@transaction.atomic
def adjust_stock(*, organization_id, stock_item, delta, actor_user_id=None, note=""):
    """Manual correction (stock count, damage, receiving new inventory)."""
    stock_item.quantity += delta
    stock_item.save(update_fields=["quantity", "updated_at"])
    return StockMovement.objects.create(
        organization_id=organization_id,
        stock_item=stock_item,
        delta=delta,
        balance_after=stock_item.quantity,
        reason="manual_adjustment",
        note=note,
        actor_user_id=actor_user_id,
    )
