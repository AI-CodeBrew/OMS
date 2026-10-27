"""WMS business logic. Kept out of views (same convention as
oms/services.py) so OMS can call straight into it - the stock check that
gates Ready to Print lives here, not in an HTTP handler."""

from django.db import transaction
from django.db.models import F
from django.utils import timezone

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


def return_line_summary(order):
    """A returned order's lines as the returns desk counts them - one per
    SKU, plus one per product name for lines with no SKU:
    [{key, sku, product_name, quantity}]. `key` is what a breakdown sent
    back to restock_from_return refers to."""
    required, _no_sku = _order_line_requirements(order)
    lines = [
        {"key": f"sku:{sku}", "sku": sku, "product_name": need["product_name"], "quantity": need["quantity"]}
        for sku, need in required.items()
    ]
    by_name = {}
    for item in order.items.all():
        if not (item.barcode or "").strip():
            name = (item.product_name or "").strip()
            by_name[name] = by_name.get(name, 0) + item.quantity
    for name, quantity in by_name.items():
        lines.append(
            {"key": f"name:{name}", "sku": "", "product_name": name or "(unnamed item)", "quantity": quantity}
        )
    return lines


def _return_stock_item(order, warehouse, line):
    """The stock item one return line (return_line_summary) goes back on,
    or None.

    By SKU first, as everywhere else. A line with no SKU (most Shopify
    stores leave it blank) falls back to its exact product name - but only
    when exactly one stock item in the warehouse has that name, so a
    returned unit is never put back on the wrong row. Returns only: booking
    (consume_for_order/check_order_stock) still matches by SKU alone, since
    name-matched shortages there would start warning on/blocking bookings.
    """
    if line["sku"]:
        item, _ = StockItem.objects.get_or_create(
            organization_id=order.organization_id,
            warehouse=warehouse,
            sku=line["sku"],
            defaults={"product_name": line["product_name"]},
        )
        return item
    name = line["key"][len("name:"):]
    if not name:
        return None
    candidates = list(
        StockItem.objects.filter(
            organization_id=order.organization_id, warehouse=warehouse, product_name__iexact=name
        )[:2]
    )
    return candidates[0] if len(candidates) == 1 else None


class InvalidReturnBreakdown(Exception):
    pass


def build_return_breakdown(order, counts=None, *, condition="good"):
    """Every line of the order with its good / damaged / lost units. `counts`
    is {key: {good, damaged, lost}} from the returns desk's popup; each line
    must add up to its quantity. Without it, every unit is `condition`
    ("good", or "bad" = damaged) - the bulk Mark Good / Mark Damaged."""
    lines = return_line_summary(order)
    breakdown = []
    for line in lines:
        if counts is None:
            good = line["quantity"] if condition == "good" else 0
            entry = {"good": good, "damaged": line["quantity"] - good, "lost": 0}
        else:
            given = counts.get(line["key"])
            if given is None:
                raise InvalidReturnBreakdown(f"Missing the count for {line['sku'] or line['product_name']}.")
            try:
                entry = {k: int(given.get(k) or 0) for k in ("good", "damaged", "lost")}
            except (TypeError, ValueError) as exc:
                raise InvalidReturnBreakdown("Counts must be whole numbers.") from exc
            if min(entry.values()) < 0:
                raise InvalidReturnBreakdown("Counts can't be negative.")
            if sum(entry.values()) != line["quantity"]:
                raise InvalidReturnBreakdown(
                    f"{line['sku'] or line['product_name']}: good + damaged + lost must equal "
                    f"{line['quantity']}."
                )
        breakdown.append({**line, **entry})
    return breakdown


def check_order_stock(order, warehouse=None, reserved=None):
    """Read-only availability check. Returns a list of shortage dicts -
    empty means everything is in stock. Never mutates anything, so the UI
    can call it to preview before committing.

    reserved ({sku: units}) is stock already promised to other orders in
    the same run (oms.services.allocate_stock) - counted as gone, and this
    order's own units are added to it when it fits."""
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
        available = (item.quantity if item else 0) - (reserved or {}).get(sku, 0)
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
    if reserved is not None and not shortages:
        for sku, need in required.items():
            reserved[sku] = reserved.get(sku, 0) + need["quantity"]
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
def restock_from_return(
    order, *, breakdown, actor_user_id=None, actor_email="", warehouse=None, note="", unmatched=None
):
    """Records a returns-desk scan outcome. Idempotent per order via
    order.return_received_at - stamped whatever the outcome, so a second
    scan of the same parcel is caught here rather than by checking for a
    StockMovement, which a parcel with no good units never creates.

    `breakdown` comes from build_return_breakdown: only each line's good
    units go back into stock. Damaged and lost units never touch
    StockItem/StockMovement - they aren't sellable stock. The breakdown is
    kept on the order, and return_condition is "good" when every unit was
    good, else "bad".

    Pass a list as `unmatched` to get the names of lines with good units
    that matched no stock item - those are received but not restocked.

    Returns None if the order was already received - the caller should
    treat that the same as any other scan failure. Otherwise returns the
    list of StockMovement rows created.
    """
    # Re-read under a row lock: two scans of the same parcel landing
    # together would otherwise both see it unreceived and restock twice.
    already = (
        type(order).all_objects.select_for_update()
        .filter(pk=order.pk)
        .values_list("return_received_at", flat=True)
        .first()
    )
    if order.return_received_at or already:
        return None

    all_good =all(line["damaged"] == 0 and line["lost"] == 0 for line in breakdown)
    order.return_received_at = timezone.now()
    order.return_received_by = actor_user_id
    order.return_received_by_email = actor_email or ""
    order.return_condition = "good" if all_good else "bad"
    order.return_breakdown = breakdown
    update_fields = [
        "return_received_at",
        "return_received_by",
        "return_received_by_email",
        "return_condition",
        "return_breakdown",
        "updated_at",
    ]

    movements = []
    warehouse = warehouse or get_default_warehouse(order.organization_id)
    if warehouse is not None:
        for line in breakdown:
            if not line["good"]:
                continue
            item = _return_stock_item(order, warehouse, line)
            if item is None:
                if unmatched is not None:
                    unmatched.append(line["product_name"])
                continue
            item.quantity += line["good"]
            item.save(update_fields=["quantity", "updated_at"])
            _queue_shopify_delta(item, line["good"])
            movements.append(
                StockMovement.objects.create(
                    organization_id=order.organization_id,
                    stock_item=item,
                    delta=line["good"],
                    balance_after=item.quantity,
                    reason="return_restock",
                    order_number=order.order_number,
                    note=note,
                    actor_user_id=actor_user_id,
                )
            )

    order.save(update_fields=update_fields)
    return movements


# Marker written into the note of a reversal movement so a second attempt
# can recognise its own work and stay idempotent. `reason` deliberately
# reuses manual_adjustment rather than adding a REASON_CHOICES value: this
# deployment does not run migrations automatically, so a new choice would
# need a migration nobody can apply.
_BOOKING_REVERSAL_MARKER = "booking-reversal"


@transaction.atomic
def release_order_stock(order, *, actor_user_id=None, warehouse=None, note=""):
    """Puts back stock that was consumed for a booking that never happened.

    consume_for_order() deducts the moment an order is pushed to a courier,
    on the assumption the parcel is now committed. When the push turns out
    to have failed - the courier never actually created the consignment -
    that deduction is against a shipment that does not exist and has to be
    undone, or the warehouse is short on paper for stock still on the shelf.

    Reverses exactly what the ledger says was taken (not what the order's
    current line items say), so an order edited since the push can't cause
    the wrong quantity to come back. Idempotent per order.
    """
    warehouse = warehouse or get_default_warehouse(order.organization_id)
    if warehouse is None:
        return []

    already = StockMovement.objects.filter(
        organization_id=order.organization_id,
        order_number=order.order_number,
        note__contains=_BOOKING_REVERSAL_MARKER,
    ).exists()
    if already:
        return []

    # Net of every dispatch consumption for this order, per stock item.
    taken = {}
    consumed = StockMovement.objects.filter(
        organization_id=order.organization_id,
        order_number=order.order_number,
        reason="order_dispatch",
    ).select_related("stock_item")
    for movement in consumed:
        taken[movement.stock_item] = taken.get(movement.stock_item, 0) + movement.delta

    movements = []
    for item, delta in taken.items():
        if delta >= 0:
            continue  # nothing was actually taken for this line
        item.quantity -= delta  # delta is negative, so this adds it back
        item.save(update_fields=["quantity", "updated_at"])
        movements.append(
            StockMovement.objects.create(
                organization_id=order.organization_id,
                stock_item=item,
                delta=-delta,
                balance_after=item.quantity,
                reason="manual_adjustment",
                order_number=order.order_number,
                note=f"{_BOOKING_REVERSAL_MARKER}: {note or 'booking was never created'}"[:255],
                actor_user_id=actor_user_id,
            )
        )
    return movements


@transaction.atomic
def import_skus_from_orders(*, organization_id, warehouse):
    """Creates a StockItem for every distinct SKU seen in order history.

    Without this the inventory screen starts empty and only fills in as
    orders consume stock - which means the first thing a SKU does is go
    negative. Seeding the catalogue at zero instead lets the warehouse
    enter real opening counts before any of it is drawn down.

    Existing rows are left untouched, so it is safe to re-run as new
    products appear.
    """
    from oms.models import OrderItem

    rows = (
        OrderItem.objects.filter(organization_id=organization_id)
        .exclude(barcode="")
        .values_list("barcode", "product_name")
    )
    seen = {}
    for sku, product_name in rows:
        seen.setdefault(sku, product_name)

    existing = set(
        StockItem.objects.filter(
            organization_id=organization_id, warehouse=warehouse
        ).values_list("sku", flat=True)
    )

    created = [
        StockItem(
            organization_id=organization_id,
            warehouse=warehouse,
            sku=sku,
            product_name=product_name or "",
            quantity=0,
        )
        for sku, product_name in seen.items()
        if sku not in existing
    ]
    StockItem.objects.bulk_create(created)
    return {"created": len(created), "skipped": len(seen) - len(created), "total_skus": len(seen)}


def _queue_shopify_delta(stock_item, delta):
    """For a Shopify-linked row, queue `delta` for "Push to Shopify". Shopify
    sync (integrations.services) sets quantity = Shopify's + this pending
    delta, so without it the next sync or inventory webhook would wipe the
    change. Added with F() so it can't race a push clearing what it sent."""
    if not stock_item.shopify_inventory_item_id:
        return
    StockItem.all_objects.filter(pk=stock_item.pk).update(
        pending_shopify_delta=F("pending_shopify_delta") + delta
    )
    stock_item.refresh_from_db(fields=["pending_shopify_delta"])


@transaction.atomic
def adjust_stock(*, organization_id, stock_item, delta, actor_user_id=None, note=""):
    """Manual correction (stock count, damage, receiving new inventory).

    For a Shopify-linked row the delta is also queued for "Push to
    Shopify" - added with F() so it can't race a push that's clearing the
    delta it already sent (see integrations.services.
    push_stock_changes_to_shopify)."""
    stock_item.quantity += delta
    stock_item.save(update_fields=["quantity", "updated_at"])
    _queue_shopify_delta(stock_item, delta)
    movement = StockMovement.objects.create(
        organization_id=organization_id,
        stock_item=stock_item,
        delta=delta,
        balance_after=stock_item.quantity,
        reason="manual_adjustment",
        note=note,
        actor_user_id=actor_user_id,
    )
    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=organization_id,
            action="wms.stock_adjust",
            summary=f"Stock adjust {stock_item.sku}: {delta:+d} (balance {stock_item.quantity})",
            actor_user_id=actor_user_id,
            entity_type="stock_item",
            entity_id=str(stock_item.id),
            metadata={
                "sku": stock_item.sku,
                "delta": delta,
                "balance_after": stock_item.quantity,
                "note": note or "",
            },
        )
    except Exception:
        pass
    return movement


@transaction.atomic
def rename_stock_item(*, organization_id, stock_item, product_name, actor_user_id=None):
    """Edits the product name from the Adjust popup. For a Shopify-linked
    row the rename is queued for "Push to Shopify", remembering the name it
    replaces for the confirmation summary; renaming back to that original
    name cancels the pending rename instead of pushing a no-op."""
    item = StockItem.all_objects.select_for_update().get(pk=stock_item.pk, organization_id=organization_id)
    old_name = item.product_name
    if product_name == old_name:
        return item

    item.product_name = product_name
    update_fields = ["product_name", "updated_at"]
    if item.shopify_inventory_item_id:
        if not item.pending_shopify_name:
            item.previous_shopify_name = old_name
        if product_name == item.previous_shopify_name:
            item.pending_shopify_name = ""
            item.previous_shopify_name = ""
        else:
            item.pending_shopify_name = product_name
        update_fields += ["pending_shopify_name", "previous_shopify_name"]
    item.save(update_fields=update_fields)

    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=organization_id,
            action="wms.stock_rename",
            summary=f"Renamed {item.sku or item.id}: {old_name!r} -> {product_name!r}",
            actor_user_id=actor_user_id,
            entity_type="stock_item",
            entity_id=str(item.id),
            metadata={"sku": item.sku, "from": old_name, "to": product_name},
        )
    except Exception:
        pass
    return item


# --------------------------------------------------------- Purchase orders --

class PurchaseOrderError(Exception):
    pass


def purchase_order_state(total_quantity, received_quantity):
    """"not_received" / "partial" / "received" - worked out from the lines,
    never stored, so it can't drift from what actually arrived."""
    if not received_quantity:
        return "not_received"
    if received_quantity >= total_quantity:
        return "received"
    return "partial"


def _add_purchase_stock(po, line, good, *, actor_user_id=None):
    """Puts `good` received units of `line` into the PO's warehouse - the
    stock row with that SKU there (a Shopify-linked one first), created if
    the warehouse has none - and logs the movement."""
    item = (
        StockItem.objects.filter(organization_id=po.organization_id, warehouse=po.warehouse, sku=line.sku)
        .order_by(F("shopify_inventory_item_id").asc(nulls_last=True))
        .first()
    )
    if item is None:
        item = StockItem.objects.create(
            organization_id=po.organization_id,
            warehouse=po.warehouse,
            sku=line.sku,
            product_name=line.product_name,
            image_url=line.image_url,
        )
    item.quantity += good
    item.save(update_fields=["quantity", "updated_at"])
    _queue_shopify_delta(item, good)
    return StockMovement.objects.create(
        organization_id=po.organization_id,
        stock_item=item,
        delta=good,
        balance_after=item.quantity,
        reason="purchase_receipt",
        order_number=po.po_number,
        note=f"Received from {po.supplier.name}"[:255],
        actor_user_id=actor_user_id,
    )


def _apply_receipt(po, line, good, damaged, *, actor_user_id=None):
    """Adds one receipt to a line: good units go into stock, damaged ones
    are only counted. Never more than the line ordered in total."""
    try:
        good, damaged = int(good or 0), int(damaged or 0)
    except (TypeError, ValueError) as exc:
        raise PurchaseOrderError("Good and Damaged must be whole numbers.") from exc
    if good < 0 or damaged < 0:
        raise PurchaseOrderError("Good and Damaged can't be negative.")
    if line.received + good + damaged > line.quantity_ordered:
        raise PurchaseOrderError(
            f"{line.sku}: {line.received + good + damaged} received would be more than the "
            f"{line.quantity_ordered} ordered."
        )
    if not good and not damaged:
        return
    line.good_received += good
    line.damaged_received += damaged
    line.save(update_fields=["good_received", "damaged_received", "updated_at"])
    if good:
        _add_purchase_stock(po, line, good, actor_user_id=actor_user_id)


@transaction.atomic
def create_purchase_order(*, organization_id, supplier, warehouse, ordered_at, lines, note="", actor_user_id=None):
    """A new PO. `lines` is [{sku, product_name, image_url, quantity_ordered,
    unit_price, good, damaged}] - good/damaged are what already arrived
    (often nothing yet); good units go straight into stock."""
    from .models import PurchaseOrder, PurchaseOrderLine

    if not lines:
        raise PurchaseOrderError("Add at least one product.")
    seen = set()
    for row in lines:
        sku = (row.get("sku") or "").strip()
        if not sku:
            raise PurchaseOrderError("Every product needs a SKU.")
        if sku in seen:
            raise PurchaseOrderError(f"{sku} is on the PO twice - put it on one line.")
        seen.add(sku)
        try:
            ordered = int(row.get("quantity_ordered") or 0)
        except (TypeError, ValueError) as exc:
            raise PurchaseOrderError(f"{sku}: quantity ordered must be a whole number.") from exc
        if ordered <= 0:
            raise PurchaseOrderError(f"{sku}: quantity ordered must be more than 0.")

    po = PurchaseOrder.objects.create(
        organization_id=organization_id,
        supplier=supplier,
        warehouse=warehouse,
        ordered_at=ordered_at or timezone.now(),
        note=(note or "")[:255],
        created_by_user_id=actor_user_id,
    )
    po.refresh_from_db(fields=["number"])
    for row in lines:
        line = PurchaseOrderLine.objects.create(
            organization_id=organization_id,
            purchase_order=po,
            sku=row["sku"].strip(),
            product_name=(row.get("product_name") or "").strip()[:255],
            image_url=(row.get("image_url") or "")[:1000],
            quantity_ordered=int(row["quantity_ordered"]),
            unit_price=row.get("unit_price") or 0,
        )
        _apply_receipt(po, line, row.get("good"), row.get("damaged"), actor_user_id=actor_user_id)
    return po


@transaction.atomic
def receive_purchase_order(po, receipts, *, actor_user_id=None):
    """Another delivery against an existing PO: `receipts` is
    {line_id: {good, damaged}}, added to what's already received."""
    lines = {str(line.id): line for line in po.lines.select_for_update()}
    for line_id, counts in receipts.items():
        line = lines.get(str(line_id))
        if line is None:
            raise PurchaseOrderError("That product isn't on this PO.")
        _apply_receipt(po, line, counts.get("good"), counts.get("damaged"), actor_user_id=actor_user_id)
    return po


# ------------------------------------------------------- Inventory overview --
# The Inventory page: every stock item with where its units are - bought in
# (purchase orders), on the shelf, out with the courier, delivered, coming
# back, damaged or lost. Order lines are matched to a stock item by SKU
# (OrderItem.barcode), or, for a stock item with no SKU, by exact product
# name - the same rule returns use (_return_stock_item).

INVENTORY_ACTIVITY = ("active", "inactive", "out_of_stock")


def _match_key(sku, name):
    sku = (sku or "").strip().lower()
    return sku if sku else "name:" + (name or "").strip().lower()


def _order_bucket(status, returning):
    """Which Inventory column an order's units count under, or None."""
    if status in ("dispatched", "out_for_delivery", "attempt") and returning:
        return "return_in_transit"
    if status in ("dispatched", "out_for_delivery"):
        return "dispatched"
    if status == "attempt":
        return "failed_delivery"
    if status == "delivered":
        return "delivered"
    return None


def _empty_metrics():
    return {
        "total_inbound": 0,
        "delivered": 0,
        "dispatched": 0,
        "failed_delivery": 0,
        "return_in_transit": 0,
        "returns_damaged": 0,
        "returns_lost": 0,
        "po_damaged": 0,
        "ordered": 0,
    }


def _order_metrics(organization_id):
    """{match key: metrics} from every order that isn't cancelled, plus
    the damaged / lost units its returns desk counted."""
    from django.db.models import BooleanField, ExpressionWrapper, Q, Sum

    from oms.models import Order, OrderItem

    metrics = {}
    rows = (
        OrderItem.all_objects.filter(organization_id=organization_id)
        .exclude(order__status="cancelled")
        .annotate(
            _returning=ExpressionWrapper(
                Q(order__return_in_progress_at__isnull=False), output_field=BooleanField()
            )
        )
        .values("barcode", "product_name", "order__status", "_returning")
        .annotate(qty=Sum("quantity"))
        .order_by()
    )
    for row in rows:
        m = metrics.setdefault(_match_key(row["barcode"], row["product_name"]), _empty_metrics())
        m["ordered"] += row["qty"] or 0
        bucket = _order_bucket(row["order__status"], row["_returning"])
        if bucket:
            m[bucket] += row["qty"] or 0

    received = Order.all_objects.filter(
        organization_id=organization_id, return_breakdown__isnull=False
    ).values_list("return_breakdown", flat=True)
    for breakdown in received:
        for line in breakdown or []:
            m = metrics.setdefault(_match_key(line.get("sku"), line.get("product_name")), _empty_metrics())
            m["returns_damaged"] += int(line.get("damaged") or 0)
            m["returns_lost"] += int(line.get("lost") or 0)
    return metrics


def _purchase_metrics(organization_id):
    """{(warehouse id, sku): (good received, damaged received)} from the
    warehouse's purchase orders."""
    from django.db.models import Sum

    from .models import PurchaseOrderLine

    rows = (
        PurchaseOrderLine.all_objects.filter(organization_id=organization_id)
        .values("purchase_order__warehouse_id", "sku")
        .annotate(good=Sum("good_received"), damaged=Sum("damaged_received"))
        .order_by()
    )
    return {
        (str(r["purchase_order__warehouse_id"]), (r["sku"] or "").strip().lower()): (r["good"] or 0, r["damaged"] or 0)
        for r in rows
    }


def inventory_activity(quantity, ordered):
    """Active: in stock and ordered. Inactive: in stock, never ordered.
    Out of stock: ordered, none on hand. "" for neither (nothing on hand,
    never ordered) - only in Total."""
    if quantity > 0:
        return "active" if ordered else "inactive"
    return "out_of_stock" if ordered else ""


def _inventory_row(item, order_metrics, purchase_metrics):
    m = dict(order_metrics.get(_match_key(item.sku, item.product_name)) or _empty_metrics())
    if item.sku:
        good, damaged = purchase_metrics.get((str(item.warehouse_id), item.sku.strip().lower()), (0, 0))
        m["total_inbound"] = good
        m["po_damaged"] = damaged
    m["damaged_lost"] = m["returns_damaged"] + m["returns_lost"] + m["po_damaged"]
    return {
        "id": str(item.id),
        "sku": item.sku,
        "product_name": item.product_name,
        "image_url": item.image_url,
        "warehouse": str(item.warehouse_id),
        "warehouse_name": item.warehouse.name,
        # On the shelf: bought in and returned good, less what couriers were
        # booked for (stock leaves at booking - consume_for_order).
        "available": item.quantity,
        "reorder_level": item.reorder_level,
        "has_pending_shopify_push": item.has_pending_shopify_push,
        "shopify_push_error": item.shopify_push_error,
        "activity": inventory_activity(item.quantity, m["ordered"]),
        **m,
    }


def inventory_overview(organization_id, *, search="", activity=""):
    """(rows, summary) for the Inventory page - every stock item, filtered
    by `search` (SKU / name) and `activity` (INVENTORY_ACTIVITY); the
    summary counts cover every item, whatever the filter."""
    order_metrics = _order_metrics(organization_id)
    purchase_metrics = _purchase_metrics(organization_id)
    items = StockItem.objects.filter(organization_id=organization_id).select_related("warehouse")
    rows = [_inventory_row(item, order_metrics, purchase_metrics) for item in items]

    summary = {"total": len(rows), **{a: 0 for a in INVENTORY_ACTIVITY}}
    for row in rows:
        if row["activity"]:
            summary[row["activity"]] += 1

    term = (search or "").strip().lower()
    if term:
        rows = [r for r in rows if term in (r["sku"] or "").lower() or term in (r["product_name"] or "").lower()]
    if activity in INVENTORY_ACTIVITY:
        rows = [r for r in rows if r["activity"] == activity]
    return rows, summary


def inventory_item_report(item):
    """One stock item's row plus where its numbers come from - the orders
    by status, the purchase orders and returns, and its stock ledger."""
    from oms.models import OrderItem

    from .models import PurchaseOrderLine

    row = _inventory_row(item, _order_metrics(item.organization_id), _purchase_metrics(item.organization_id))

    lines = OrderItem.all_objects.filter(organization_id=item.organization_id).select_related(
        "order", "order__courier"
    )
    lines = (
        lines.filter(barcode__iexact=item.sku)
        if item.sku
        else lines.filter(barcode="", product_name__iexact=item.product_name)
    )
    orders = [
        {
            "order_id": str(line.order.id),
            "order_number": line.order.order_number,
            "customer_name": line.order.customer_name,
            "status": line.order.status,
            "status_label": line.order.get_status_display(),
            "returning": bool(line.order.return_in_progress_at),
            "quantity": line.quantity,
            "total": str(line.order.grand_total),
            "courier": line.order.courier.name if line.order.courier_id else "",
            "tracking_number": line.order.tracking_number,
            "date": line.order.placed_at or line.order.created_at,
            "created_at": line.order.created_at,
        }
        for line in lines.order_by("-order__created_at")[:500]
    ]

    purchases = [
        {
            "po_number": line.purchase_order.po_number,
            "supplier": line.purchase_order.supplier.name,
            "ordered_at": line.purchase_order.ordered_at,
            "quantity_ordered": line.quantity_ordered,
            "good": line.good_received,
            "damaged": line.damaged_received,
            "unit_price": str(line.unit_price),
        }
        for line in PurchaseOrderLine.all_objects.filter(
            organization_id=item.organization_id,
            purchase_order__warehouse=item.warehouse,
            sku__iexact=item.sku,
        )
        .select_related("purchase_order__supplier")
        .order_by("-purchase_order__ordered_at")
    ] if item.sku else []

    movements = [
        {
            "date": m.created_at,
            "reason": m.get_reason_display(),
            "delta": m.delta,
            "balance_after": m.balance_after,
            "reference": m.order_number,
            "note": m.note,
        }
        for m in item.movements.order_by("-created_at")[:500]
    ]
    return {"item": row, "orders": orders, "purchases": purchases, "movements": movements}
