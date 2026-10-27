import logging
import time
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import OperationalError, connections, transaction
from django.db.models import F
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.context import audit_source, tenant_context
from core.events import publish_event
from core.platform_service import is_platform_organization
from oms.models import Courier, Order, OrderItem

from . import shopify_client, smartlane_client
from .models import ShopifyConnection, ShopifySyncJob

logger = logging.getLogger(__name__)


# Once an order reaches one of these, a later Shopify sync must not
# rewrite its status - the physical/financial outcome is already recorded
# on our side and Shopify's view is no longer authoritative.
TERMINAL_STATUSES = {"delivered", "returned", "cancelled"}

# OMS status -> the Shopify tag it should carry. Prefixed so this never
# collides with a merchant's own tags, and so re-syncing can find and
# replace exactly its own previous tag instead of guessing.
_SHOPIFY_STATUS_TAG_PREFIX = "OMS:"
_SHOPIFY_STATUS_TAGS = {
    "ready_to_print": "OMS:Booked",
    "ready_to_pick": "OMS:Booked",
    # Handed over to the courier (load sheet made), not picked up yet.
    "awaiting_dispatched": "OMS:Booked",
    "dispatched": "OMS:Dispatched",
    # Still on the move - Shopify's own Delivery status says which stage.
    "out_for_delivery": "OMS:Dispatched",
    "attempt": "OMS:Dispatched",
    "delivered": "OMS:Delivered",
    "returned": "OMS:Returned",
    "cancelled": "OMS:Cancelled",
}
# Statuses at which the tracking number is trustworthy enough to push as a
# Shopify fulfillment - before this it's either empty or (with the current
# create_booking stub) a placeholder, not a real courier tracking number.
_SHOPIFY_FULFILLMENT_STATUSES = {
    "ready_to_print", "ready_to_pick", "awaiting_dispatched", "dispatched", "out_for_delivery",
    "attempt", "delivered",
}

# OMS status -> Shopify's fixed Fulfillment Event `status` values, which
# drive the "Delivery status" column on Shopify's own Orders list -
# separate from (and posted after) the fulfillment created above. Only
# valid once a fulfillment already exists, so these only ever fire for
# statuses reached after dispatch. Shopify has no equivalent "returned"/
# "cancelled" shipment status, so those two stay tag-only (see
# _SHOPIFY_STATUS_TAGS) - a Delivery status like that would misrepresent
# what Shopify itself understands a fulfillment's lifecycle to be.
_SHOPIFY_SHIPMENT_STATUS = {
    "dispatched": "in_transit",
    "out_for_delivery": "out_for_delivery",
    "attempt": "attempted_delivery",
    "delivered": "delivered",
}


def sync_order_to_shopify(order, *, with_events=True):
    """Best-effort push of what the OMS pipeline now knows back onto the
    Shopify order it came from: fulfillment tracking number/courier, a
    Delivery-status timeline event (in_transit/out_for_delivery/
    attempted_delivery/delivered - see _SHOPIFY_SHIPMENT_STATUS) once that
    fulfillment exists, and a status tag (Booked/Dispatched/Delivered/
    Returned/Cancelled) merged alongside the order's own custom tag and
    whatever tags the merchant already had on the order.

    Called from oms.services._transition after every status change - never
    raises, since a Shopify API hiccup here must not block or roll back an
    OMS-side transition that already happened. Silently does nothing for
    orders that didn't come from Shopify (no shopify_order_id), when
    Shopify isn't connected for this org, or when the separate
    "Status Push to Shopify" toggle (push_status_to_shopify) is off - this
    is deliberately independent of auto_sync_orders (which only gates the
    *inbound* import direction), since writing to a merchant's live Shopify
    order is an opt-in a tenant should switch on explicitly.

    Deliberately does NOT touch Shopify's own order totals/shipping_lines -
    rewriting a live order's financial fields is a different, riskier
    operation than tagging and fulfilling it, so delivery-charge sync stays
    OMS-side only for now.

    with_events=False leaves out the Delivery-status event - see
    push_statuses_to_shopify. Returns what Shopify refused, as messages
    (empty when all went through, or there was nothing to push).
    """
    if not order.shopify_order_id:
        return []
    try:
        connection = ShopifyConnection.all_objects.get(
            organization_id=order.organization_id, is_connected=True, push_status_to_shopify=True
        )
    except ShopifyConnection.DoesNotExist:
        return []

    args = (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)
    errors = []

    if order.tracking_number and order.status in _SHOPIFY_FULFILLMENT_STATUSES and not order.shopify_fulfillment_id:
        try:
            fulfillment = shopify_client.create_fulfillment(
                *args,
                order.shopify_order_id,
                tracking_number=order.tracking_number,
                tracking_company=order.courier.name if order.courier_id else "",
            )
            order.shopify_fulfillment_id = fulfillment.get("id")
            Order.all_objects.filter(pk=order.pk).update(
                shopify_fulfillment_id=order.shopify_fulfillment_id
            )
        except shopify_client.ShopifyAPIError as exc:
            # Already fulfilled on Shopify (by the courier's own app, say)
            # isn't a failure - not fatal here either way.
            if "No open fulfillment orders" not in str(exc):
                errors.append(str(exc))

    # Delivery-status timeline - only meaningful once a fulfillment exists,
    # so this only fires for statuses reached after the block above (or a
    # prior sync) has already set shopify_fulfillment_id.
    shipment_status = _SHOPIFY_SHIPMENT_STATUS.get(order.status)
    if with_events and shipment_status and order.shopify_fulfillment_id:
        try:
            shopify_client.create_fulfillment_event(
                *args, order.shopify_order_id, order.shopify_fulfillment_id, shipment_status
            )
        except shopify_client.ShopifyAPIError as exc:
            errors.append(str(exc))

    status_tag = _SHOPIFY_STATUS_TAGS.get(order.status)
    if status_tag or order.tag:
        try:
            # Read from Shopify itself, not our copy: an update replaces the
            # order's whole tag list, and the rest of it is the merchant's
            # (and other apps') - our copy never held those, so writing from
            # it wiped them. Only our own OMS: tag is swapped.
            current = [
                t.strip()
                for t in shopify_client.fetch_order_tags(*args, order.shopify_order_id).split(",")
                if t.strip()
            ]
            existing = [t for t in current if not t.startswith(_SHOPIFY_STATUS_TAG_PREFIX)]
            merged = list(dict.fromkeys(existing + [t for t in (status_tag, order.tag) if t]))
            if set(merged) != set(current):
                shopify_client.update_order_tags(*args, order.shopify_order_id, ", ".join(merged))
            order.customer_tags = ", ".join(merged)[:255]
            Order.all_objects.filter(pk=order.pk).update(customer_tags=order.customer_tags)
        except shopify_client.ShopifyAPIError as exc:
            errors.append(str(exc))
    return errors


# The statuses "Push all statuses now" sends - each carries a Shopify tag or
# a fulfillment (sync_order_to_shopify).
_PUSHABLE_STATUSES = set(_SHOPIFY_STATUS_TAGS) | _SHOPIFY_FULFILLMENT_STATUSES


def push_statuses_to_shopify(organization_id, *, after="", limit=10):
    """One batch of the Shopify page's "Push all statuses now": what
    sync_order_to_shopify sends on every status change, for orders that
    reached their status before Status Push was turned on. The page calls
    this again with `next` (the batch's last order id) until it's None.

    No Delivery-status events: on old orders those could set off Shopify's
    "out for delivery" / "delivered" emails to customers. The fulfillment
    itself is created without notifying anyone (shopify_client.
    create_fulfillment), and the status tag shows where each order is.
    Shopify's ~2 requests/second limit is waited out rather than failed."""
    orders = (
        Order.all_objects.filter(
            organization_id=organization_id,
            shopify_order_id__isnull=False,
            status__in=_PUSHABLE_STATUSES,
        )
        .select_related("courier")
        .order_by("id")
    )
    total = None if after else orders.count()
    if after:
        orders = orders.filter(id__gt=after)
    batch = list(orders[:limit])

    failed = []
    with shopify_client.wait_out_rate_limits():
        for order in batch:
            errors = sync_order_to_shopify(order, with_events=False)
            if errors:
                failed.append(f"{order.order_number}: {errors[0][:200]}")
    return {
        "total": total,
        "processed": len(batch),
        "failed": len(failed),
        "errors": failed[:5],
        "next": str(batch[-1].id) if len(batch) == limit else None,
    }


def _to_decimal(value):
    try:
        return Decimal(str(value)) if value is not None else Decimal("0")
    except InvalidOperation:
        return Decimal("0")


def _truncate(value, max_length):
    """Defensively caps a Shopify-sourced string to its column's
    max_length. A single unexpectedly long field (malformed address data,
    a postal code that's actually a full address, etc.) should never be
    able to abort an entire multi-thousand-order sync with a Postgres
    'value too long' error - better to store a truncated value than lose
    the whole order."""
    value = value or ""
    return value[:max_length]


# Shopify's shipment_status values that mean the parcel reached the
# customer / came back. Everything else (in_transit, out_for_delivery,
# label_printed, ...) still counts as on its way, which our pipeline
# already represents as "dispatched".
_SHOPIFY_DELIVERED = {"delivered"}
_SHOPIFY_RETURNED = {"returned", "return_to_sender"}


def _latest_fulfillment(shopify_order):
    """The most recent non-cancelled fulfillment, or None.

    Tracking number, carrier name and delivery status all live inside
    order.fulfillments[] rather than on the order itself - a partially
    fulfilled order can carry several, so the newest one is what
    describes where the parcel currently is.
    """
    fulfillments = [
        f
        for f in (shopify_order.get("fulfillments") or [])
        if (f.get("status") or "") != "cancelled"
    ]
    if not fulfillments:
        return None
    return sorted(fulfillments, key=lambda f: f.get("created_at") or "")[-1]


def _shipping_total(shopify_order):
    """Delivery charges. Prefers the money-set field, falling back to
    summing shipping_lines for older API payloads that lack it."""
    price_set = shopify_order.get("total_shipping_price_set") or {}
    shop_money = price_set.get("shop_money") or {}
    if shop_money.get("amount") is not None:
        return _to_decimal(shop_money.get("amount"))
    return sum(
        (_to_decimal(line.get("price")) for line in shopify_order.get("shipping_lines") or []),
        Decimal("0"),
    )


def _shopify_money(shopify_order):
    """The order's money split so that Order.grand_total comes out as
    Shopify's own total_price - what the customer pays, and what a courier
    is told to collect:

      total_amount     line items before discounts (total_line_items_price),
                       the same as OMS's own subtotal once an order is edited
      coupon_discount  what the discounts took off those items. Shopify's
                       subtotal_price is already after discounts, so the
                       earlier subtotal_price - total_discounts took them
                       off twice
      total_tax        only when charged on top - with taxes_included it's
                       already inside the item prices
      shipping_amount  everything else total_price adds: shipping after its
                       own discounts (plus tips or duties, if a store has any)

    A payload without total_price (older API versions) falls back to the
    shipping lines."""
    items_after_discounts = _to_decimal(shopify_order.get("subtotal_price"))
    items = _to_decimal(shopify_order.get("total_line_items_price")) or items_after_discounts
    tax = Decimal("0") if shopify_order.get("taxes_included") else _to_decimal(shopify_order.get("total_tax"))
    if shopify_order.get("total_price") is not None:
        shipping = _to_decimal(shopify_order.get("total_price")) - items_after_discounts - tax
    else:
        shipping = _shipping_total(shopify_order)
    return {
        "total_amount": items,
        "coupon_discount": max(items - items_after_discounts, Decimal("0")),
        "total_tax": tax,
        "shipping_amount": max(shipping, Decimal("0")),
    }


# Shopify financial statuses where the customer still pays the rest in
# cash - the courier collects it. Anything else (paid, authorized, refunded,
# ...) was paid online.
_SHOPIFY_COD_FINANCIAL_STATUSES = {"", "pending", "partially_paid"}


# Shopify's cancel_reason codes, in the words its admin shows.
_SHOPIFY_CANCEL_REASONS = {
    "customer": "Customer changed or cancelled order",
    "fraud": "Fraudulent order",
    "inventory": "Items unavailable",
    "declined": "Payment declined",
    "staff": "Staff error",
    "other": "Other",
}


def _shopify_payment(shopify_order, money):
    """payment_gateway / payment_status / amount_paid for a Shopify order,
    so that Order.amount_receivable - what the order screen shows and the
    COD every courier is told to collect - is what the customer still owes:

      paid online      cc,  amount_paid = the whole total  -> receivable 0
      partially paid   cod, amount_paid = total - Shopify's total_outstanding
                       (the advance)                       -> the rest
      pending (COD)    cod, amount_paid = 0                -> the whole total

    Never touches the fields behind grand_total - `money` is only read."""
    financial_status = shopify_order.get("financial_status") or ""
    if shopify_order.get("total_price") is not None:
        total = _to_decimal(shopify_order.get("total_price"))
    else:
        total = (
            money["total_amount"] - money["coupon_discount"] + money["total_tax"] + money["shipping_amount"]
        )
    if financial_status not in _SHOPIFY_COD_FINANCIAL_STATUSES:
        return {
            "payment_gateway": "cc",
            "payment_status": "paid" if financial_status == "paid" else "pending",
            "amount_paid": total,
        }
    outstanding = shopify_order.get("total_outstanding")
    paid = total - _to_decimal(outstanding) if outstanding is not None else Decimal("0")
    paid = min(max(paid, Decimal("0")), total)
    return {
        "payment_gateway": "cod",
        "payment_status": "partially_paid" if paid > 0 else "pending",
        "amount_paid": paid,
    }


@audit_source("Shopify")
def upsert_order_from_shopify(organization_id, shopify_order, shop_label=""):
    """Create or update an oms.Order from a Shopify order payload (webhook
    or REST sync - same shape either way). Runs outside normal
    JWT-authenticated request context (webhooks carry no Supabase JWT), so
    it always uses the unscoped `all_objects` manager and passes
    organization_id explicitly rather than relying on ambient tenant
    context."""
    shopify_order_id = shopify_order["id"]
    customer = shopify_order.get("customer") or {}
    shipping_address = shopify_order.get("shipping_address") or {}
    # Orders created from OMS (create_order_on_shopify) carry no customer
    # record when there's no email - the name is on the address.
    customer_name = (
        " ".join(filter(None, [customer.get("first_name"), customer.get("last_name")])).strip()
        or (shipping_address.get("name") or "").strip()
        or shopify_order.get("email")
        or "Unknown"
    )
    billing_address = shopify_order.get("billing_address") or {}
    # order.phone/customer.phone are frequently null - guest/COD checkouts
    # (the common case here) only carry a contact number on the address,
    # which is what actually matters for delivery.
    phone = (
        shopify_order.get("phone")
        or customer.get("phone")
        or shipping_address.get("phone")
        or billing_address.get("phone")
        or ""
    )
    billing_phone = billing_address.get("phone") or ""
    secondary_phone = billing_phone if billing_phone and billing_phone != phone else ""

    shopify_fulfillment_status = shopify_order.get("fulfillment_status")
    fulfillment_status = "fulfilled" if shopify_fulfillment_status == "fulfilled" else "unfulfilled"

    fulfillment = _latest_fulfillment(shopify_order) or {}
    shipment_status = (fulfillment.get("shipment_status") or "").lower()
    tracking_number = fulfillment.get("tracking_number") or ""
    if not tracking_number:
        numbers = fulfillment.get("tracking_numbers") or []
        tracking_number = numbers[0] if numbers else ""
    carrier_name = (fulfillment.get("tracking_company") or "").strip()

    if shopify_order.get("cancelled_at"):
        pipeline_status = "cancelled"
    elif shipment_status in _SHOPIFY_RETURNED:
        pipeline_status = "returned"
    elif shipment_status in _SHOPIFY_DELIVERED:
        pipeline_status = "delivered"
    elif shopify_fulfillment_status == "fulfilled":
        pipeline_status = "dispatched"
    else:
        # Everything unfulfilled enters the untouched "New" inbox. CS moves
        # it into Awaiting Assigning when they pick it up (see
        # oms.services.acknowledge_order) - that hand-off is what makes
        # "nobody has looked at this" distinguishable from "in progress".
        pipeline_status = "new"

    order_number = shopify_order.get("name") or f"#{shopify_order.get('order_number', shopify_order_id)}"

    shopify_created_at = shopify_order.get("created_at")
    placed_at = parse_datetime(shopify_created_at) if shopify_created_at else None

    money = _shopify_money(shopify_order)
    payment = _shopify_payment(shopify_order, money)

    # Fields safe to refresh from Shopify on every sync. `status` is
    # deliberately NOT among them: it's our own pipeline state, advanced by
    # the CS/warehouse team, and re-syncing an order must never undo their
    # work by dragging it back to the entry state. It's set once, on
    # create, via create_defaults below.
    shopify_fields = {
        "order_number": _truncate(order_number, 50),
        "customer_name": _truncate(customer_name, 255),
        "customer_phone": _truncate(phone, 50),
        "secondary_phone": _truncate(secondary_phone, 50),
        **payment,
        "fulfillment_status": fulfillment_status,
        "city": _truncate(shipping_address.get("city"), 100),
        "shop": _truncate(shop_label or "Shopify", 150),
        **money,
        "tracking_number": _truncate(tracking_number, 100),
        "customer_email": _truncate(shopify_order.get("email"), 255),
        "address_line1": _truncate(shipping_address.get("address1"), 255),
        "address_line2": _truncate(shipping_address.get("address2"), 255),
        "postal_code": _truncate(shipping_address.get("zip"), 50),
        "country": _truncate(shipping_address.get("country"), 100),
        "order_source": "Manual" if _is_oms_manual(shopify_order) else "Storefront",
        "placed_at": placed_at,
        "customer_note": shopify_order.get("note") or "",
    }
    # Cancelled on Shopify: its reason, as Shopify's admin words it.
    if shopify_order.get("cancelled_at"):
        reason = (shopify_order.get("cancel_reason") or "").strip().lower()
        shopify_fields["cancel_reason"] = _truncate(
            "Shopify: " + _SHOPIFY_CANCEL_REASONS.get(reason, reason.replace("_", " ").capitalize() or "Cancelled"),
            255,
        )

    # The carrier Shopify recorded on the fulfillment ("TCS", "Leopards",
    # ...). Matched by name so repeated syncs reuse one Courier row rather
    # than creating a duplicate per order.
    if carrier_name:
        courier, _ = Courier.all_objects.get_or_create(
            organization_id=organization_id,
            name=_truncate(carrier_name, 150),
            defaults={"is_active": True},
        )
        shopify_fields["courier_id"] = courier.id

    # A fulfillment with no tracking number (or none at all - e.g. a store
    # whose token can't create fulfillments, so OMS's tracking never reaches
    # Shopify) must not erase the one OMS booked: our own status-tag push
    # fires orders/updated, which used to blank it on every booked order.
    update_fields = dict(shopify_fields)
    if not update_fields["tracking_number"]:
        del update_fields["tracking_number"]

    order, created = Order.all_objects.update_or_create(
        organization_id=organization_id,
        shopify_order_id=shopify_order_id,
        defaults=update_fields,
        create_defaults={**shopify_fields, "status": pipeline_status},
    )

    previous_status = order.status

    # Outcomes Shopify genuinely knows better than our pipeline does -
    # applied on update too, but only ever moving an order forward, never
    # back onto one the team has already carried past this point.
    if not created and order.status not in TERMINAL_STATUSES:
        if pipeline_status == "cancelled":
            order.status = "cancelled"
            order.save(update_fields=["status", "updated_at"])
        elif pipeline_status == "returned":
            # Applied from any non-terminal state, not just dispatched: on a
            # historical re-pull an order may still be sitting early in the
            # pipeline here while Shopify already knows the parcel shipped
            # and came back. The physical outcome is the truth.
            order.status = "returned"
            order.returned_at = order.returned_at or timezone.now()
            order.save(update_fields=["status", "returned_at", "updated_at"])
        elif pipeline_status == "delivered":
            order.status = "delivered"
            order.delivered_at = order.delivered_at or timezone.now()
            order.save(update_fields=["status", "delivered_at", "updated_at"])

    # Part of the order's history on the Logs tabs - attributed to Shopify
    # by @audit_source.
    if created or order.status != previous_status:
        from core.rbac import write_audit_log

        labels = dict(Order.STATUS_CHOICES)
        try:
            write_audit_log(
                organization_id=organization_id,
                action="order.received" if created else "order.status_change",
                summary=(
                    f"Order {order.order_number} received from Shopify"
                    if created
                    else f"Order {order.order_number}: {labels.get(previous_status, previous_status)}"
                    f" → {labels.get(order.status, order.status)}"
                ),
                entity_type="order",
                entity_id=str(order.id),
                metadata={"order_number": order.order_number, "to_status": order.status},
            )
        except Exception:
            logger.warning("audit log for Shopify order %s failed", order.order_number, exc_info=True)

    # Line items can change between webhook deliveries (edited orders) -
    # full replace is simpler and safer than diffing. Done in one
    # transaction holding the order's row lock: Shopify often sends
    # orders/create and orders/updated within the same second (or a webhook
    # lands mid-sync), and two unlocked replaces interleaved their deletes
    # and inserts, leaving a line item stored twice.
    # Weights Shopify doesn't send back (an order made in OMS has them from
    # its form) are carried over to the replacement rows, by SKU + name.
    with transaction.atomic():
        Order.all_objects.select_for_update().filter(pk=order.pk).first()
        old_items = OrderItem.all_objects.filter(order=order)
        weights = {
            (item.barcode, item.product_name): item.weight_grams
            for item in old_items
            if item.weight_grams
        }
        old_items.delete()
        new_items = []
        for line_item in shopify_order.get("line_items", []):
            title = line_item.get("title") or "Item"
            # The variant is part of what was bought - "Pack of 2" x1 is two
            # units in the parcel - so it goes into the name every screen,
            # waybill and courier booking prints. Same "Title - Variant"
            # shape as WMS stock items (sync_stock_items_from_shopify_product_payload).
            variant = (line_item.get("variant_title") or "").strip()
            product_name = _truncate(
                f"{title} - {variant}" if variant and variant != "Default Title" else title, 255
            )
            barcode = _truncate(line_item.get("sku"), 100)
            new_items.append(OrderItem(
                organization_id=organization_id,
                order=order,
                product_name=product_name,
                quantity=line_item.get("quantity") or 1,
                unit_price=_to_decimal(line_item.get("price")),
                barcode=barcode,
                # Rows saved before variants were in the name are keyed
                # by the bare title.
                weight_grams=weights.get((barcode, product_name)) or weights.get((barcode, title[:255])),
            ))
        OrderItem.all_objects.bulk_create(new_items)

    publish_event(
        "order.created" if created else "order.updated",
        {
            "organization_id": str(organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "shopify",
        },
    )
    return order, created


# Tag on every order create_order_on_shopify makes, so later webhooks for
# it still know it was booked by hand in OMS rather than at the checkout.
_OMS_MANUAL_TAG = "OMS Manual"


def _is_oms_manual(shopify_order):
    tags = [t.strip() for t in (shopify_order.get("tags") or "").split(",")]
    return _OMS_MANUAL_TAG in tags


def create_order_on_shopify(
    organization_id, *, customer_name, customer_phone, items, extra_fields=None, note="", actor_user_id=None
):
    """Manual Order with "Also create on Shopify": creates the order on the
    connected store first - Shopify gives it the store's next order number -
    then stores it here through the same upsert the order webhook uses, so
    it carries shopify_order_id and that webhook (which may well land
    first) updates this one row instead of making a second. From there it
    is an ordinary Shopify order: status push, courier booking, and so on.

    Line items whose SKU is a product on Shopify are that product (Shopify
    takes its stock down, as at checkout); any other is a custom line item.
    Raises InventorySyncError with Shopify's message if it refuses."""
    extra = dict(extra_fields or {})
    connection, args = _connected_shopify(organization_id)

    first_name, _, last_name = customer_name.strip().partition(" ")
    address = {
        "first_name": first_name,
        "last_name": last_name,
        "name": customer_name.strip(),
        "address1": extra.get("address_line1", ""),
        "address2": extra.get("address_line2", ""),
        "city": extra.get("city", ""),
        "zip": extra.get("postal_code", ""),
        "country": "Pakistan",
        "phone": customer_phone,
    }
    prepaid = extra.get("payment_gateway") == "cc"
    shipping = Decimal(str(extra.get("shipping_amount") or 0))
    discount = Decimal(str(extra.get("coupon_discount") or 0))

    with shopify_client.wait_out_rate_limits():
        try:
            line_items = []
            for item in items:
                sku = (item.get("barcode") or "").strip()
                variant_id = shopify_client.find_variant_id_by_sku(*args, sku) if sku else None
                line = {"quantity": item["quantity"], "price": str(item["unit_price"])}
                if variant_id:
                    line["variant_id"] = variant_id
                else:
                    line.update(title=item["product_name"], sku=sku, requires_shipping=True)
                if item.get("weight_grams"):
                    line["grams"] = item["weight_grams"]
                line_items.append(line)

            total = sum(Decimal(str(i["unit_price"])) * i["quantity"] for i in items) + shipping - discount
            payload = {
                "line_items": line_items,
                "shipping_address": address,
                "billing_address": address,
                "shipping_lines": [{"title": "Shipping", "code": "Shipping", "price": str(shipping)}],
                # Phone goes on the address only: a customer record with a
                # phone that another customer already has is rejected.
                "email": extra.get("customer_email", ""),
                "financial_status": "paid" if prepaid else "pending",
                "inventory_behaviour": "decrement_obeying_policy",
                "send_receipt": False,
                "send_fulfillment_receipt": False,
                "note": note,
                "tags": _OMS_MANUAL_TAG,
            }
            if discount:
                # Comes back as the order's coupon_discount through
                # _shopify_money, like a checkout discount would.
                payload["discount_codes"] = [
                    {"code": "OMS Discount", "amount": str(discount), "type": "fixed_amount"}
                ]
            if prepaid:
                payload["transactions"] = [{"kind": "sale", "status": "success", "amount": str(total)}]
            if extra.get("placed_at"):
                payload["processed_at"] = extra["placed_at"].isoformat()
            if not payload["email"]:
                del payload["email"]
            created = shopify_client.create_order(*args, payload)
        except shopify_client.ShopifyAPIError as exc:
            raise InventorySyncError(str(exc)[:500]) from exc

    order, _ = upsert_order_from_shopify(
        organization_id, created, shop_label=connection.shop_name or connection.shop_domain
    )

    # What the form knows that Shopify's copy doesn't hold.
    updates = {}
    if extra.get("secondary_phone"):
        updates["secondary_phone"] = extra["secondary_phone"][:50]
    if updates:
        Order.all_objects.filter(pk=order.pk).update(**updates)
    # By SKU first: a product line item comes back under the product's own
    # title on Shopify, not the name typed in the form.
    by_sku = {(i.get("barcode") or "").strip(): i.get("weight_grams") for i in items if i.get("barcode")}
    by_name = {i["product_name"]: i.get("weight_grams") for i in items}
    for item in OrderItem.all_objects.filter(order=order, weight_grams__isnull=True):
        weight = (by_sku.get(item.barcode) if item.barcode else None) or by_name.get(item.product_name)
        if weight:
            item.weight_grams = weight
            item.save(update_fields=["weight_grams"])
    if note:
        from oms.models import OrderNote

        OrderNote.all_objects.create(organization_id=organization_id, order=order, kind="note", body=note)

    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=organization_id,
            action="oms.shopify_order_create",
            summary=f"Created order {order.order_number} on Shopify ({connection.shop_domain})",
            actor_user_id=actor_user_id,
            entity_type="order",
            entity_id=str(order.id),
            metadata={"shopify_order_id": created.get("id")},
        )
    except Exception:  # noqa: BLE001
        pass
    order.refresh_from_db()
    return order


# How Smartlane's reported states map onto our pipeline. Anything not
# listed (queued, ready, dispatch, in_transit, ...) means the parcel is
# still moving, which "dispatched" already covers. out_for_delivery/attempt
# get their own OMS statuses (see oms.models.Order.STATUS_CHOICES) rather
# than collapsing into "dispatched" like the rest of this set - they're
# Smartlane's own vocabulary for sub-stages of dispatched a user actually
# cares to see distinguished (dispute is deliberately NOT handled - out of
# scope; return_in_progress is handled separately below, it's not a status
# transition at all, see _resolve_return_in_progress).
_SMARTLANE_STATUS_MAP = {
    "delivered": "delivered",
    "complete": "delivered",
    "completed": "delivered",
    "return": "returned",
    "returned": "returned",
    "cancel": "cancelled",
    "cancelled": "cancelled",
    "out_for_delivery": "out_for_delivery",
    "ofd": "out_for_delivery",
    "attempt": "attempt",
}

# Shared with the webhook (views.smartlane_shipment_webhook) so a status
# seen by polling and the same status arriving by webhook always produce
# the same outcome - moves the order on to Dispatched.
#
# "dispatch" (not "dispatched") is taken from the per-stage timestamp
# fields on Smartlane's own Consignment Status webhook payload - queue /
# ready / dispatch / out_for_delivery / attempt / return_in_progress /
# complete / return / cancel / dispute - which is the vocabulary their
# pipeline actually uses. "picked"/"in_transit" are kept because they cost
# nothing, but they do NOT appear in that payload.
_SMARTLANE_DISPATCH_STATUSES = {
    "dispatch",
    "dispatched",
    "picked",
    "in_transit",
}

# Confirmed against a real booked order's /track response (not a guess):
# every response carries these per-stage timestamp fields, each left as
# this exact placeholder until that milestone genuinely happens, then
# filled in with a real "YYYY-MM-DD HH:MM:SS". That makes them a far more
# reliable signal than courier_status/state, which can be blank (courier
# hadn't reported anything yet on that same real order) or use spellings
# we've only partially confirmed (only "ready" seen for certain so far).
_BLANK_STAGE_TIMESTAMP = "0000-00-00 00:00:00"


def _stage_happened(row, key):
    value = row.get(key)
    return bool(value) and value != _BLANK_STAGE_TIMESTAMP


def _resolve_smartlane_target(smartlane_status, row=None):
    """What a Smartlane event means for our pipeline - "delivered",
    "returned", "cancelled", "attempt", "out_for_delivery", "dispatch"
    (still moving, not yet any of the more specific sub-stages), or None
    (nothing actionable).

    Stage timestamps (row) are tried first when available, string status
    (_SMARTLANE_STATUS_MAP/_SMARTLANE_DISPATCH_STATUSES) is the fallback
    for when row is missing or its stage fields are all still blank. Checked
    most-advanced-stage-first, since a later stage having happened implies
    every earlier one already did too. return_in_progress deliberately does
    NOT count as "returned" here - it means the return has started, not
    that it's finished; only a real `return` timestamp is treated as the
    final outcome (see _resolve_return_in_progress for that stage instead).
    """
    if row:
        if _stage_happened(row, "complete"):
            return "delivered"
        if _stage_happened(row, "return"):
            return "returned"
        if _stage_happened(row, "cancel"):
            return "cancelled"
        if _stage_happened(row, "attempt"):
            return "attempt"
        if _stage_happened(row, "out_for_delivery"):
            return "out_for_delivery"
        if _stage_happened(row, "dispatch"):
            return "dispatch"

    target = _SMARTLANE_STATUS_MAP.get(smartlane_status)
    if target:
        return target
    if smartlane_status in _SMARTLANE_DISPATCH_STATUSES:
        return "dispatch"
    return None


def _resolve_return_in_progress(smartlane_status, row=None):
    """Whether this event indicates Smartlane's return_in_progress stage -
    checked independently of _resolve_smartlane_target since it's not a
    status transition, just a timestamp (see Order.return_in_progress_at
    and its docstring for why this belongs to WMS's returns-desk domain
    rather than the OMS status pipeline)."""
    if row and _stage_happened(row, "return_in_progress"):
        return True
    return smartlane_status == "return_in_progress"


def extract_smartlane_event(payload):
    """Pulls (order_number, tracking_number, smartlane_status) out of a
    Smartlane payload - shared by the poller and the webhook so they can
    never disagree on how to read the same fields.

    tracking_number is blanked out when it's still the "Not Assigned Yet"
    placeholder Smartlane uses before a real consignment number exists -
    treating that string as a real value (a bug the poller had on its own
    copy of this logic) would save it as the literal tracking_number and
    prematurely advance a Booking Pending order that hasn't actually been
    booked yet.
    """
    order_number = str(payload.get("store_order_id") or payload.get("order_number") or "").strip()
    tracking_number = str(
        payload.get("consignment_number") or payload.get("tracking_number") or ""
    ).strip()
    if tracking_number.lower().startswith("not assigned"):
        tracking_number = ""
    smartlane_status = (
        str(payload.get("courier_status") or payload.get("state") or payload.get("status") or "")
    ).strip().lower().replace(" ", "_")
    return order_number, tracking_number, smartlane_status


def smartlane_status_label(payload):
    """Smartlane's own word for where the parcel is, for the orders list's
    Sub Status (oms.services.record_courier_status) - the same field
    extract_smartlane_event reads the status from, as written, with a bare
    stage name made readable ("out_for_delivery" -> "Out For Delivery")."""
    label = str(
        payload.get("courier_status") or payload.get("state") or payload.get("status") or ""
    ).strip()
    if label == label.lower():
        label = label.replace("_", " ").title()
    return label


def find_order_by_smartlane_reference(reference):
    """Smartlane echoes back the store_order_id we sent, but a Shopify-style
    order name ("#10133") does not reliably survive that round trip - the
    '#' is frequently dropped. Match on both spellings rather than losing
    the event, the same lesson oms.importers already learned.

    Caller must have the tenant context set (or pass an org-scoped manager).
    """
    value = (reference or "").strip()
    if not value:
        return None
    stripped = value.lstrip("#")
    for candidate in dict.fromkeys([value, f"#{stripped}", stripped]):
        order = Order.objects.filter(order_number=candidate).first()
        if order:
            return order
    return None


def find_platform_order(reference):
    """The order a Dispatch Hub booking through FynkTech's own Smartlane
    account was sent as `reference` (Order.platform_reference - a store
    code then digits, never a '#'). Searches every store: that account's
    bookings belong to many."""
    value = (reference or "").strip().lstrip("#")
    if not value:
        return None
    return Order.all_objects.filter(platform_reference=value).first()


def _catch_up_to_dispatched(order, tracking_number=""):
    """Walks an order forward to `dispatched`, through whatever intermediate
    states it never went through locally.

    This exists because Smartlane's outcome events are only applicable from
    `dispatched`: mark_delivered is a dispatched->delivered transition, and
    scan_return refuses anything that isn't dispatched/delivered. So if we
    ever miss the intermediate "dispatch" event - a webhook delivery that
    failed, or simply the poller not running that hour - the later
    "complete"/"return" event could not be applied at all, and the order
    jammed at Ready to Print permanently while the parcel was long gone.

    Smartlane reporting a terminal outcome is proof the parcel physically
    moved, so the local workflow gates (printing a loadsheet, picking) are
    catching up to reality rather than authorising it. This is the same
    reasoning the dispatch branch already used for ready_to_print; it just
    has to apply to the outcome events too.

    ready_to_print dispatches directly now - printing a loadsheet/airway
    bill is no longer itself a transition (an order stays visibly "Ready
    to Print" through as many downloads as needed), so there's no
    intermediate ready_to_pick step to walk through here any more either.
    """
    from oms import services as oms_services

    if order.status == "booking_pending":
        # Only legal with a consignment number in hand, which is what
        # "booked" means - without one there is nothing to advance on.
        if not tracking_number and not order.tracking_number:
            return False
        oms_services.advance_booking_confirmed(order)
    if order.status in ("ready_to_print", "ready_to_pick", "approved", "awaiting_dispatched"):
        oms_services.dispatch_order(order, tracking_number=tracking_number)
    return order.status == "dispatched"


def _advance_to_dispatch_substate(order, target, tracking_number=""):
    """Lands an order on "out_for_delivery" or "attempt" - Smartlane
    sub-stages of dispatched (see oms.services.ALLOWED_TRANSITIONS) -
    catching up to at least dispatched first via _catch_up_to_dispatched if
    the order hasn't gotten there locally yet. Same "Smartlane reporting it
    is proof it happened" reasoning that function already uses."""
    from oms import services as oms_services

    if order.status == target:
        return False
    if order.status not in ("dispatched", "out_for_delivery", "attempt"):
        if not _catch_up_to_dispatched(order, tracking_number):
            return False
    if target == "out_for_delivery":
        oms_services.mark_out_for_delivery(order)
    else:
        oms_services.mark_delivery_attempt_failed(order)
    return True


@audit_source("Smartlane")
def apply_smartlane_status(order, smartlane_status, *, tracking_number="", organization_id, row=None):
    """Applies one Smartlane status to one order. Shared by the webhook and
    the poller so a status seen either way can never produce a different
    outcome. Returns True if the order actually moved.

    `row` is the full raw payload/track-row when the caller has it -
    passing it lets _resolve_smartlane_target use the confirmed-reliable
    stage timestamps instead of guessing from courier_status/state alone.

    Raises oms.services.InvalidTransition for the caller to log/skip.
    """
    from oms import services as oms_services

    # Independent of `target` below - not a status transition, just a
    # timestamp WMS can use later (see Order.return_in_progress_at). Checked
    # on every event regardless of what else it resolves to, since a real
    # payload could carry this stage timestamp alongside a later one.
    # Stamps Order.return_in_progress_at, which puts the order under Return
    # in Transit.
    if _resolve_return_in_progress(smartlane_status, row):
        oms_services.mark_return_in_progress(
            order, courier_label="Smartlane", tracking_number=tracking_number
        )

    target = _resolve_smartlane_target(smartlane_status, row)
    before = order.status

    if target == "delivered":
        if order.status == "delivered":
            return False
        _catch_up_to_dispatched(order, tracking_number)
        oms_services.mark_delivered(order)
    elif target == "returned":
        if order.status == "returned":
            return False
        _catch_up_to_dispatched(order, tracking_number)
        # scan_return reports failure by return value, not by raising, so
        # an unusable status would otherwise be a silent no-op here.
        result = oms_services.scan_return(
            organization_id=organization_id,
            order_number=order.order_number,
            reason="Reported returned by Smartlane",
        )
        if not result.get("success"):
            logger.warning("smartlane: could not mark %s returned - %s",
                           order.order_number, result.get("reason"))
            return False
    elif target == "cancelled":
        # Cancelled on Smartlane's side: the booking is gone, not the order
        # - it goes back to Awaiting Assigning to be booked again.
        if not oms_services.unbook_cancelled_by_courier(order, courier_label="Smartlane"):
            return False
    elif target in ("out_for_delivery", "attempt"):
        if not _advance_to_dispatch_substate(order, target, tracking_number):
            return False
    elif target == "dispatch":
        if order.status == "dispatched":
            return False
        if not _catch_up_to_dispatched(order, tracking_number):
            return False
    else:
        return False

    logger.info("smartlane status %r (target=%s) applied to %s: %s -> %s",
                smartlane_status, target, order.order_number, before, order.status)
    return True


# "Nothing wrong here, we just never processed this order locally" -
# statuses it's safe to fast-forward straight to Booking Pending once
# Smartlane proves the booking is real (see absorb_untracked_smartlane_order).
# city_issue/dispatch_issue are deliberately excluded - those are real local
# exceptions a human flagged and must not be silently jumped past.
# awaiting_dispatched is also excluded - an order there is already booked
# and handed over (its load sheet made), so there is nothing to absorb.
_ABSORBABLE_STATUSES = {
    "new", "pending_cc", "pending_cod",
    "awaiting_assigning", "awaiting_approval", "approved",
}


def _without_direct_courier_bookings(queryset):
    """Drops orders booked with PostEx or BarqRaftar (an active shipment row
    in either integration). Those have their own pollers and webhooks, so
    Smartlane is never asked about them and never allowed to move them -
    not even when Smartlane happens to know a booking with the same order
    number, which would otherwise overwrite their tracking number/status.
    Goes through the reverse relations rather than importing either
    integration's models, so this module stays independent of both."""
    return queryset.exclude(postex_shipments__is_active=True).exclude(
        barqraftar_shipments__is_active=True
    )


def is_booked_with_direct_courier(order):
    """True if `order` is PostEx's or BarqRaftar's - see
    _without_direct_courier_bookings. Used by the Smartlane webhook."""
    return not _without_direct_courier_bookings(Order.all_objects.filter(id=order.id)).exists()


def absorb_untracked_smartlane_order(
    order, *, raw_status, row, actor_user_id=None, courier_name="Smartlane"
):
    """Order Smartlane recognises (a /track row or webhook event arrived for
    it) whose local status shows it was never pushed through
    oms.services.push_order_to_smartlane - most commonly, booked directly on
    Smartlane's own portal (e.g. by file import) rather than through this
    app. Shared by the poller and the webhook, same reasoning as
    apply_smartlane_status just below: a status seen either way must never
    produce a different outcome.

    Absorbs on ANY recognised row, not just ones resolving to a dispatch/
    delivered/returned target - a "queued"/"ready" row with no stage
    timestamps yet is still proof of a real Smartlane consignment (exactly
    the state push_order_to_smartlane itself produces the instant its
    booking call is accepted, before any tracking number exists).

    Deliberately does NOT check for a conflicting local courier assignment -
    Smartlane's report wins regardless, per instruction.

    `courier_name` is the SmartlaneConnection.courier_name of the account
    that reported it, so the order is tracked through that account from
    here on.

    Returns True if it changed the order."""
    from oms import services as oms_services

    if order.status not in _ABSORBABLE_STATUSES:
        return False

    target = _resolve_smartlane_target(raw_status, row)
    if target == "cancelled":
        # A booking made on Smartlane's portal and cancelled there again -
        # there's nothing to absorb, and the order itself isn't cancelled
        # (it was never booked through OMS), so it stays where it is.
        return False

    oms_services.absorb_smartlane_booking(
        order, actor_user_id=actor_user_id, courier_name=courier_name
    )
    return True


def poll_smartlane_statuses(organization_id, *, batch_size=50, limit=500, job=None):
    """Pulls booking/delivery outcomes from Smartlane and advances matching
    orders - including orders booked directly on Smartlane's own portal that
    this app never pushed there itself (see absorb_untracked_smartlane_order).

    Runs as a scheduled job (see integrations.poller, or the poll_smartlane
    management command) rather than waiting on the status webhook, because
    the webhook needs a publicly reachable HTTPS URL while this works from
    anywhere. Same data, a polling interval later.

    Only ever moves an order forward - a stale or out-of-order tracking
    row must not drag something already delivered back into transit.

    batch_size=50 is not a guess - Smartlane's /track rejects anything
    bigger with "The store order id must not have more than 50 items"
    (confirmed against a real response; their own API doc doesn't mention
    this cap). Never seen before this function's query was broadened to
    check every non-final order, because a 100-item batch of genuinely
    Smartlane-booked orders alone was rare enough to never hit it.

    `job` is an optional SmartlaneSyncJob (see run_smartlane_sync) - when
    given, progress (total_available/checked_count/updated_count) is saved
    as the run proceeds and cancel_requested is honoured between chunks, so
    the manual "Sync now" button can show live progress and be cancelled
    instead of blocking on one opaque request. The auto-poller
    (integrations.poller) and the poll_smartlane management command don't
    have a job and just get the plain synchronous behaviour as before.
    """
    from core.context import current_organization_id
    from oms import services as oms_services
    from .models import SmartlaneConnection

    if is_platform_organization(organization_id):
        return _poll_platform_smartlane(
            organization_id, oms_services, batch_size=batch_size, limit=limit, job=job,
        )

    # Every connected account - the org's own Smartlane and OMS Courier are
    # separate accounts, each only knowing about its own bookings.
    connections = list(
        SmartlaneConnection.all_objects.filter(
            organization_id=organization_id, is_connected=True
        ).order_by("kind")
    )
    if not connections:
        logger.warning("smartlane poll skipped for org %s: not connected", organization_id)
        return {"checked": 0, "updated": 0, "detail": "Smartlane is not connected"}

    # Same as the webhook: tenant managers return nothing in a
    # management command / poller thread without this.
    _org_token = current_organization_id.set(organization_id)
    try:
        totals = {"checked": 0, "updated": 0}
        for connection in connections:
            result = _poll_smartlane_statuses_body(
                organization_id, connection, oms_services,
                batch_size=batch_size, limit=limit, job=job, done=totals,
            )
            totals["checked"] += result["checked"]
            totals["updated"] += result["updated"]
            if result.get("cancelled"):
                return {**totals, "cancelled": True}
        return totals
    finally:
        current_organization_id.reset(_org_token)


def _poll_smartlane_statuses_body(
    organization_id, connection, oms_services, *, batch_size, limit, job=None, done=None
):
    """One account's share of poll_smartlane_statuses. `done` is what the
    accounts polled before this one already counted, so a job's progress
    keeps climbing across accounts instead of restarting at zero."""
    base_checked = (done or {}).get("checked", 0)
    base_updated = (done or {}).get("updated", 0)

    # Deliberately NOT filtered to this account's own courier - that field
    # is only ever set by push_order_to_smartlane/absorb_smartlane_booking,
    # so an order booked directly on Smartlane's own portal (this app's
    # actual, dominant workflow - see absorb_untracked_smartlane_order)
    # would never have it set and would be invisible to this poll forever.
    # Asking Smartlane about every non-final order and trusting its "unknown
    # to us" 422 handling (smartlane_client.track_consignments) to filter
    # out the rest is simpler and correct, at the cost of some wasted
    # lookups. Only orders already booked through the org's OTHER account,
    # with PostEx/BarqRaftar (see _without_direct_courier_bookings), or
    # through FynkTech's own account from the Dispatch Hub
    # (platform_reference - see _poll_platform_smartlane) are left out -
    # this one can't know them.
    # smartlane_checked_at, nulls first, rotates the never/least-recently-
    # checked orders to the front each cycle instead of only ever checking
    # the same newest ones.
    other_couriers = [
        name for kind, name in connection.COURIER_NAMES.items() if kind != connection.kind
    ]
    orders = list(
        _without_direct_courier_bookings(
            Order.all_objects.filter(organization_id=organization_id, platform_reference="")
            .exclude(status__in=TERMINAL_STATUSES)
            .exclude(courier__name__in=other_couriers)
        )
        .order_by(F("smartlane_checked_at").asc(nulls_first=True), "id")[:limit]
    )
    if not orders:
        logger.info("smartlane poll for org %s (%s): no non-final orders",
                    organization_id, connection.kind)
        if job is not None and not base_checked:
            job.total_available = 0
            _save_progress(job, ["total_available", "updated_at"])
        return {"checked": 0, "updated": 0}

    logger.info("smartlane poll for org %s (%s): checking %s order(s)",
                organization_id, connection.kind, len(orders))
    if job is not None:
        job.total_available = base_checked + len(orders)
        _save_progress(job, ["total_available", "updated_at"])

    # Keyed by both spellings of the order number - Smartlane does not
    # reliably echo back the leading '#' (see
    # find_order_by_smartlane_reference).
    by_number = {}
    for o in orders:
        stripped = o.order_number.lstrip("#")
        for key in dict.fromkeys([o.order_number, f"#{stripped}", stripped]):
            by_number.setdefault(key, o)
    updated = 0
    checked = 0

    for start in range(0, len(orders), batch_size):
        chunk = orders[start : start + batch_size]
        # Exactly the spelling we booked with - one id per order. Asking for
        # both "#10133" and "10133" would guarantee a 422, because Smartlane
        # rejects the whole request if any single id is unknown to it and
        # only one of the two spellings can ever exist.
        try:
            rows = smartlane_client.track_consignments(
                connection.api_key, [o.order_number for o in chunk]
            )
        except smartlane_client.SmartlaneAPIError as exc:
            # One bad chunk (rate limit, transient 5xx, or a batch so
            # overwhelmingly unknown-to-Smartlane that the one 422 retry
            # track_consignments does still isn't enough) must not abort
            # every other chunk in this run - it'll be retried next poll
            # since it isn't stamped below.
            logger.error("smartlane poll chunk failed for org %s (%s order(s)): %s",
                         organization_id, len(chunk), exc)
            continue

        checked += len(chunk)
        Order.all_objects.filter(id__in=[o.id for o in chunk]).update(
            smartlane_checked_at=timezone.now()
        )

        for row in rows:
            if not isinstance(row, dict):
                continue
            row_number, consignment, raw_status = extract_smartlane_event(row)
            order = by_number.get(row_number)
            if order is None:
                logger.debug("smartlane poll: row for %r matches no order we asked about", row_number)
                continue
            oms_services.record_courier_status(order, smartlane_status_label(row))

            # Keep the consignment number Smartlane assigned, which for a
            # real booking only becomes known after the fact. consignment
            # is already blank (not the "Not Assigned Yet" placeholder) at
            # this point - extract_smartlane_event handles that.
            if consignment and consignment != order.tracking_number:
                order.tracking_number = _truncate(consignment, 100)
                order.save(update_fields=["tracking_number", "updated_at"])
                # Same reasoning as the webhook's identical branch (see
                # integrations/views.py) - no status change here, but the
                # row itself changed and would otherwise never reach
                # core/realtime.py at all.
                publish_event(
                    "order.updated",
                    {
                        "organization_id": str(order.organization_id),
                        "order_id": str(order.id),
                        "order_number": order.order_number,
                        "source": "smartlane",
                    },
                )

            try:
                if order.status in _ABSORBABLE_STATUSES:
                    if absorb_untracked_smartlane_order(
                        order, raw_status=raw_status, row=row,
                        courier_name=connection.courier_name,
                    ):
                        updated += 1
                    continue

                if order.status == "booking_pending":
                    # The consignment number arriving is what "booked" means
                    # here - move on to Ready to Print the moment it's known.
                    if consignment:
                        oms_services.advance_booking_confirmed(order)
                        updated += 1
                        continue
                    # No CN yet - the one other thing worth acting on this
                    # early is Smartlane cancelling the booking before ever
                    # issuing one (the webhook already handles this; the
                    # poll path didn't, since it always continued here
                    # regardless of what raw_status said - a real order
                    # could sit stuck in Booking Pending forever if that
                    # webhook was ever missed). apply_smartlane_status's own
                    # "cancelled" branch doesn't need a tracking number;
                    # its delivered/returned/dispatch branches safely no-op
                    # here via _catch_up_to_dispatched's own no-CN-at-all guard.
                    if apply_smartlane_status(
                        order, raw_status, tracking_number=consignment,
                        organization_id=organization_id, row=row,
                    ):
                        updated += 1
                    continue

                if apply_smartlane_status(
                    order,
                    raw_status,
                    tracking_number=consignment,
                    organization_id=organization_id,
                    row=row,
                ):
                    updated += 1
            except oms_services.InvalidTransition:
                # Already past this point locally - the tracking row is
                # stale, not wrong. Skip rather than fail the whole poll.
                continue
            except Exception:
                # One order's unexpected failure (e.g. a genuine DB error
                # out of consume_for_order) must not abort the whole batch.
                logger.exception("smartlane poll: unexpected error handling order %s",
                                  order.order_number)
                continue

        if job is not None:
            job.checked_count = base_checked + checked
            job.updated_count = base_updated + updated
            _save_progress(job, ["checked_count", "updated_count", "updated_at"])
            # Cooperative cancellation - same convention as run_shopify_sync.
            # Only these two fields, so this doesn't clobber the counters
            # just saved above with a stale in-memory copy.
            job.refresh_from_db(fields=["cancel_requested", "status"])
            if job.cancel_requested:
                logger.info("smartlane poll for org %s: cancelled after %s/%s order(s)",
                            organization_id, checked, len(orders))
                return {"checked": checked, "updated": updated, "cancelled": True}

    connection.last_event_at = timezone.now()
    connection.save(update_fields=["last_event_at"])
    logger.info("smartlane poll for org %s (%s) finished: checked %s, updated %s",
                organization_id, connection.kind, checked, updated)
    return {"checked": checked, "updated": updated}


def _poll_platform_smartlane(organization_id, oms_services, *, batch_size, limit, job=None):
    """poll_smartlane_statuses for FynkTech's own Smartlane account (the
    super admin's OMS Couriers tab, on the platform org). It only ever
    knows the orders the Dispatch Hub booked through it - spread across
    many stores, each under its store-coded Order.platform_reference rather
    than its order number - so those are exactly what it asks about, by
    that reference. Nothing to absorb (every one was booked here), and each
    order is updated inside its own store's tenant context."""
    from .models import SmartlaneConnection

    connection = SmartlaneConnection.all_objects.filter(
        organization_id=organization_id, kind=SmartlaneConnection.KIND_OWN, is_connected=True
    ).first()
    if connection is None:
        logger.warning("smartlane poll skipped for the platform org: not connected")
        return {"checked": 0, "updated": 0, "detail": "Smartlane is not connected"}

    orders = list(
        _without_direct_courier_bookings(
            Order.all_objects.exclude(platform_reference="")
            .filter(courier__name=connection.courier_name)
            .exclude(status__in=TERMINAL_STATUSES)
        )
        .order_by(F("smartlane_checked_at").asc(nulls_first=True), "id")[:limit]
    )
    if job is not None:
        job.total_available = len(orders)
        _save_progress(job, ["total_available", "updated_at"])
    if not orders:
        logger.info("smartlane poll for the platform org: no Dispatch Hub bookings to check")
        return {"checked": 0, "updated": 0}

    by_reference = {o.platform_reference: o for o in orders}
    checked = 0
    updated = 0
    for start in range(0, len(orders), batch_size):
        chunk = orders[start : start + batch_size]
        try:
            rows = smartlane_client.track_consignments(
                connection.api_key, [o.platform_reference for o in chunk]
            )
        except smartlane_client.SmartlaneAPIError as exc:
            logger.error("smartlane poll chunk failed for the platform org (%s order(s)): %s",
                         len(chunk), exc)
            continue

        checked += len(chunk)
        Order.all_objects.filter(id__in=[o.id for o in chunk]).update(
            smartlane_checked_at=timezone.now()
        )
        for row in rows:
            if not isinstance(row, dict):
                continue
            reference, consignment, raw_status = extract_smartlane_event(row)
            order = by_reference.get(reference.lstrip("#"))
            if order is None:
                continue
            try:
                with tenant_context(order.organization_id):
                    if _apply_platform_smartlane_row(order, consignment, raw_status, row, oms_services):
                        updated += 1
            except oms_services.InvalidTransition:
                continue
            except Exception:
                logger.exception("smartlane poll: unexpected error handling order %s", order.order_number)

        if job is not None:
            job.checked_count = checked
            job.updated_count = updated
            _save_progress(job, ["checked_count", "updated_count", "updated_at"])
            job.refresh_from_db(fields=["cancel_requested", "status"])
            if job.cancel_requested:
                return {"checked": checked, "updated": updated, "cancelled": True}

    connection.last_event_at = timezone.now()
    connection.save(update_fields=["last_event_at"])
    logger.info("smartlane poll for the platform org finished: checked %s, updated %s", checked, updated)
    return {"checked": checked, "updated": updated}


def _apply_platform_smartlane_row(order, consignment, raw_status, row, oms_services):
    """One /track row for a Dispatch Hub booking - the store poll's own
    per-row handling (consignment number first, then Booking Pending ->
    Ready to Print, then the status), minus absorbing. Returns True if the
    order visibly changed."""
    changed = False
    oms_services.record_courier_status(order, smartlane_status_label(row))
    if consignment and consignment != order.tracking_number:
        order.tracking_number = _truncate(consignment, 100)
        order.save(update_fields=["tracking_number", "updated_at"])
        publish_event(
            "order.updated",
            {
                "organization_id": str(order.organization_id),
                "order_id": str(order.id),
                "order_number": order.order_number,
                "source": "smartlane",
            },
        )
        changed = True
    if order.status == "booking_pending" and consignment:
        oms_services.advance_booking_confirmed(order)
        return True
    moved = apply_smartlane_status(
        order, raw_status, tracking_number=consignment,
        organization_id=order.organization_id, row=row,
    )
    return moved or changed


def run_smartlane_sync(organization_id, job_id):
    """The actual sync work behind the manual "Sync now" button, run on a
    background thread (see integrations/views.py's SmartlaneSyncView.post) -
    same shape as run_shopify_sync just above, so the two integrations'
    manual-sync UX match. Threads don't inherit the request thread's tenant
    contextvar, so this uses `all_objects` with an explicit organization_id
    throughout rather than relying on ambient context."""
    from .models import SmartlaneSyncJob

    job = SmartlaneSyncJob.all_objects.get(organization_id=organization_id, id=job_id)
    try:
        job.status = "running"
        job.started_at = timezone.now()
        _save_progress(job, ["status", "started_at", "updated_at"])

        result = poll_smartlane_statuses(organization_id, job=job)

        job.checked_count = result.get("checked", job.checked_count)
        job.updated_count = result.get("updated", job.updated_count)
        job.status = "cancelled" if result.get("cancelled") else "completed"
        job.finished_at = timezone.now()
        _save_progress(job, ["checked_count", "updated_count", "status", "finished_at", "updated_at"])
    except Exception as exc:
        # Unsupervised background thread, must not vanish silently.
        logger.exception("smartlane sync job %s failed for org %s", job_id, organization_id)
        job.status = "failed"
        job.error_message = str(exc)[:500]
        job.finished_at = timezone.now()
        try:
            _save_progress(job, ["status", "error_message", "finished_at", "updated_at"])
        except OperationalError:
            pass
    finally:
        connections.close_all()


def _month_windows(start, end):
    """Yields (window_start, window_end) covering start..end one calendar
    month at a time, both timezone-aware UTC."""
    cursor = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while cursor <= end:
        if cursor.month == 12:
            nxt = cursor.replace(year=cursor.year + 1, month=1)
        else:
            nxt = cursor.replace(month=cursor.month + 1)
        yield cursor, min(nxt - timedelta(microseconds=1), end)
        cursor = nxt


def find_order_gaps(organization_id):
    """Compares what Shopify says exists against what we actually hold,
    month by month, and reports the windows that are short.

    Why this exists: incremental sync only ever looks *forward* from
    last_synced_at, so orders missed in the middle of history (an
    interrupted full sync that never covered a stretch) are invisible to
    it - clicking "Sync New Orders" forever returns 0 while the hole
    stays. This finds those holes so they can be backfilled explicitly.

    Month granularity is deliberate: one API call per month keeps the scan
    well inside Shopify's rate limit, and backfilling a whole month costs
    nothing extra because order upserts are idempotent.
    """
    connection = ShopifyConnection.all_objects.get(
        organization_id=organization_id, is_connected=True
    )
    args = (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)

    total_remote = shopify_client.fetch_order_count(*args)
    total_local = Order.all_objects.filter(
        organization_id=organization_id, shopify_order_id__isnull=False
    ).count()

    result = {
        "total_remote": total_remote,
        "total_local": total_local,
        "missing": max(total_remote - total_local, 0),
        "gaps": [],
    }
    if total_remote <= total_local:
        return result

    earliest_raw = shopify_client.fetch_earliest_order_date(*args)
    if not earliest_raw:
        return result
    earliest = parse_datetime(earliest_raw)
    now = timezone.now()

    # Local counts bucketed by month in one query rather than one per
    # window - the remote side is what costs API calls, not this.
    local_by_month = {}
    rows = (
        Order.all_objects.filter(organization_id=organization_id, shopify_order_id__isnull=False)
        .values_list("placed_at", "created_at")
    )
    for placed_at, created_at in rows:
        stamp = placed_at or created_at
        if stamp:
            local_by_month[(stamp.year, stamp.month)] = (
                local_by_month.get((stamp.year, stamp.month), 0) + 1
            )

    # Same bucketing at day resolution, for the drill-down below.
    local_by_day = {}
    for placed_at, created_at in rows:
        stamp = placed_at or created_at
        if stamp:
            key = stamp.date()
            local_by_day[key] = local_by_day.get(key, 0) + 1

    for window_start, window_end in _month_windows(earliest, now):
        remote = shopify_client.fetch_order_count(
            *args,
            created_at_min=window_start.isoformat(),
            created_at_max=window_end.isoformat(),
        )
        local = local_by_month.get((window_start.year, window_start.month), 0)
        if remote > local:
            month_gap = {
                "from": window_start.date().isoformat(),
                "to": window_end.date().isoformat(),
                "label": window_start.strftime("%b %Y"),
                "remote": remote,
                "local": local,
                "missing": remote - local,
            }
            # Narrow the month down to the specific days that are short.
            # Counts are cheap (one request each) while backfilling is
            # thousands of per-order writes, so spending ~30 extra requests
            # here to avoid re-pulling a whole complete month is a very
            # good trade - it's the difference between refetching 2,000
            # orders and refetching the 520 actually missing.
            month_gap["ranges"] = _find_day_ranges(
                args, window_start, window_end, local_by_day
            )
            result["gaps"].append(month_gap)
        # Stay comfortably under Shopify's ~2 requests/second.
        time.sleep(0.2)

    # Flattened, deduplicated day ranges across every gap - what the
    # backfill actually syncs.
    result["ranges"] = [r for gap in result["gaps"] for r in gap.get("ranges", [])]
    return result


def _find_day_ranges(args, month_start, month_end, local_by_day):
    """Walks a short month day by day and returns the contiguous runs of
    days where Shopify holds more orders than we do."""
    missing_days = []
    cursor = month_start
    while cursor <= month_end:
        day_end = min(
            cursor.replace(hour=23, minute=59, second=59, microsecond=999999), month_end
        )
        remote = shopify_client.fetch_order_count(
            *args, created_at_min=cursor.isoformat(), created_at_max=day_end.isoformat()
        )
        local = local_by_day.get(cursor.date(), 0)
        if remote > local:
            missing_days.append({"date": cursor.date(), "missing": remote - local})
        time.sleep(0.2)
        cursor += timedelta(days=1)

    # Collapse consecutive days into ranges so the backfill runs a handful
    # of wide queries rather than one per day.
    ranges = []
    for entry in missing_days:
        if ranges and entry["date"] == ranges[-1]["_end"] + timedelta(days=1):
            ranges[-1]["_end"] = entry["date"]
            ranges[-1]["to"] = entry["date"].isoformat()
            ranges[-1]["missing"] += entry["missing"]
        else:
            ranges.append(
                {
                    "from": entry["date"].isoformat(),
                    "to": entry["date"].isoformat(),
                    "missing": entry["missing"],
                    "_end": entry["date"],
                }
            )
    for r in ranges:
        r.pop("_end", None)
    return ranges


def _save_progress(job, update_fields, attempts=3, delay_seconds=3):
    """Saves sync progress with a short retry - Supabase's pooler host has
    been observed to have brief (few-second) DNS blips on this network, and
    losing a whole multi-hour sync to one transient hiccup (now that
    connect_timeout makes it fail fast instead of hanging - see
    config/settings/base.py) would be a worse outcome than a few seconds'
    pause here. A persistent outage still fails after `attempts` and
    propagates to run_shopify_sync's own try/except, same as before."""
    for attempt in range(attempts):
        try:
            job.save(update_fields=update_fields)
            return
        except OperationalError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay_seconds)


def _iter_windows(connection, windows):
    """Chains iter_order_pages across several date windows so a multi-range
    backfill reads as one continuous stream of pages to the caller."""
    for window_min, window_max in windows:
        yield from shopify_client.iter_order_pages(
            connection.shop_domain,
            connection.access_token,
            settings.SHOPIFY_API_VERSION,
            created_at_min=window_min,
            created_at_max=window_max,
        )


def collect_missing_order_ids(connection, organization_id, windows):
    """Order ids present in Shopify within `windows` but absent locally.

    Shopify can only filter by date, so a gap range always also contains
    orders we already hold - often the large majority of it. Asking for
    ids alone first (cheap: one field, 250 per page) and diffing against
    what's stored turns "re-fetch 2,600 orders to recover 530" into
    "fetch exactly the 530".
    """
    remote_ids = set()
    for window_min, window_max in windows:
        for id_page in shopify_client.iter_order_ids(
            connection.shop_domain,
            connection.access_token,
            settings.SHOPIFY_API_VERSION,
            created_at_min=window_min,
            created_at_max=window_max,
        ):
            remote_ids.update(id_page)

    if not remote_ids:
        return []

    local_ids = set(
        Order.all_objects.filter(
            organization_id=organization_id, shopify_order_id__in=remote_ids
        ).values_list("shopify_order_id", flat=True)
    )
    return sorted(remote_ids - local_ids)


def _iter_orders_by_ids(connection, order_ids, batch_size=250):
    """Yields pages of full order payloads for specific ids."""
    for start in range(0, len(order_ids), batch_size):
        yield shopify_client.fetch_orders_by_ids(
            connection.shop_domain,
            connection.access_token,
            settings.SHOPIFY_API_VERSION,
            order_ids[start : start + batch_size],
        )


def run_shopify_sync(organization_id, job_id, *, connection_id, created_at_min=None, created_at_max=None):
    """The actual sync work, run on a background thread (see
    integrations/views.py's ShopifySyncView.post). Threads don't inherit
    the request thread's tenant contextvar, so - like upsert_order_from_shopify
    above - this uses `all_objects` with an explicit organization_id
    throughout rather than relying on ambient context."""
    job = ShopifySyncJob.all_objects.get(organization_id=organization_id, id=job_id)
    try:
        connection = ShopifyConnection.all_objects.get(
            organization_id=organization_id, id=connection_id
        )
        job.status = "running"
        job.started_at = timezone.now()

        # A backfill job carries several disconnected windows; everything
        # else is a single (possibly unbounded) window.
        if job.ranges:
            windows = [
                (f"{r['from']}T00:00:00Z", f"{r['to']}T23:59:59Z") for r in job.ranges
            ]
        else:
            windows = [(created_at_min, created_at_max)]

        if job.ranges:
            # Backfill: resolve the exact ids we're missing first, so the
            # expensive per-order work covers only those - not every order
            # that happens to share a date with them.
            missing_ids = collect_missing_order_ids(connection, organization_id, windows)
            job.total_available = len(missing_ids)
            pages = _iter_orders_by_ids(connection, missing_ids)
        else:
            # Best-effort - if Shopify's count endpoint is briefly
            # unreachable, the sync still runs, it just can't show a
            # "remaining" figure.
            try:
                job.total_available = sum(
                    shopify_client.fetch_order_count(
                        connection.shop_domain,
                        connection.access_token,
                        settings.SHOPIFY_API_VERSION,
                        created_at_min=window_min,
                        created_at_max=window_max,
                    )
                    for window_min, window_max in windows
                )
            except shopify_client.ShopifyAPIError:
                job.total_available = None
            pages = _iter_windows(connection, windows)

        job.save(update_fields=["status", "started_at", "total_available", "updated_at"])

        shop_label = connection.shop_name or connection.shop_domain
        for page in pages:
            for i, shopify_order in enumerate(page):
                # One order with unexpected data (encoding issue, a field
                # value Postgres rejects, etc.) must not abort a run that's
                # otherwise successfully processing thousands of others -
                # count it and move on instead of letting the whole sync
                # fail. `_truncate` in upsert_order_from_shopify already
                # handles the common case (an oversized field); this is the
                # backstop for anything else.
                try:
                    _, created = upsert_order_from_shopify(
                        organization_id, shopify_order, shop_label=shop_label
                    )
                    if created:
                        job.created_count += 1
                    else:
                        job.updated_count += 1
                except Exception as exc:  # noqa: BLE001 - see comment above
                    job.skipped_count += 1
                    job.error_message = (
                        f"Skipped order {shopify_order.get('name', shopify_order.get('id'))}: {exc}"
                    )[:500]
                job.total_fetched += 1

                # Orders arrive in created_at-ascending order (see
                # iter_order_pages), so this is always moving forward -
                # if this job dies, the next one resumes from exactly here
                # instead of restarting the whole sync from page 1.
                order_created_at = shopify_order.get("created_at")
                if order_created_at:
                    job.resume_cursor = order_created_at

                # Each order is a real DB round-trip (~0.5-1s) - a 250-order
                # page can take minutes, so save progress every 25 orders
                # instead of only once per full page. Otherwise the polling
                # UI shows nothing moving for that whole stretch and looks
                # stuck even though it's working.
                if (i + 1) % 25 == 0:
                    _save_progress(
                        job,
                        [
                            "total_fetched",
                            "created_count",
                            "updated_count",
                            "skipped_count",
                            "error_message",
                            "resume_cursor",
                            "updated_at",
                        ],
                    )

            job.pages_fetched += 1
            _save_progress(
                job,
                [
                    "pages_fetched",
                    "total_fetched",
                    "created_count",
                    "updated_count",
                    "skipped_count",
                    "error_message",
                    "resume_cursor",
                    "updated_at",
                ]
            )

            # Cooperative cancellation - re-read just this one flag (not the
            # whole row, which would clobber the counters just saved above)
            # to see if the cancel endpoint was hit by a separate request
            # while this page was in flight.
            job.refresh_from_db(fields=["cancel_requested", "status"])
            if job.cancel_requested:
                job.status = "cancelled"
                job.finished_at = timezone.now()
                job.save(update_fields=["status", "finished_at", "updated_at"])
                return
            if job.status not in ("pending", "running"):
                # A GET poll already marked this job stale/failed (its
                # updated_at went quiet past STALE_JOB_SECONDS - see
                # views.ShopifySyncView.get) while this thread was actually
                # still alive, just slow. Don't stomp that externally-set
                # terminal status back to "completed" - the orders already
                # upserted above are safe regardless, but the job record
                # should stay whatever the frontend already reported.
                return

        job.status = "completed"
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "finished_at", "updated_at"])

        connection.last_synced_at = timezone.now()
        connection.save(update_fields=["last_synced_at"])
    except Exception as exc:  # noqa: BLE001 - unsupervised background thread, must not vanish silently
        job.status = "failed"
        job.error_message = str(exc)[:500]
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "error_message", "finished_at", "updated_at"])
    finally:
        # Background threads must close their own DB connections - Django
        # only recycles them automatically around the request/response cycle.
        connections.close_all()


class InventorySyncError(Exception):
    pass


def _upsert_stock_item_from_shopify(organization_id, warehouse, *, shopify_inventory_item_id, sku, name, quantity):
    """Creates or updates the one StockItem for a Shopify variant, keyed
    by shopify_inventory_item_id rather than sku - sku can be blank (not
    every variant has one) or, for a row created before this field
    existed, simply not yet linked. A legacy sku-keyed row (from
    import_skus_from_orders, a manual Add Stock Item, or a pre-this-
    feature sync) is adopted on first match instead of creating a
    duplicate. Shared by the manual full sync and both the product and
    inventory-level webhooks. Returns (item, created, quantity_changed).
    """
    from wms.models import StockItem, StockMovement

    item = StockItem.all_objects.filter(
        organization_id=organization_id, warehouse=warehouse,
        shopify_inventory_item_id=shopify_inventory_item_id,
    ).first()
    if item is None and sku:
        item = StockItem.all_objects.filter(
            organization_id=organization_id, warehouse=warehouse,
            shopify_inventory_item_id__isnull=True, sku=sku,
        ).first()

    if item is None:
        item = StockItem.all_objects.create(
            organization_id=organization_id,
            warehouse=warehouse,
            shopify_inventory_item_id=shopify_inventory_item_id,
            sku=sku,
            product_name=name,
            quantity=quantity,
        )
        StockMovement.all_objects.create(
            organization_id=organization_id,
            stock_item=item,
            delta=quantity,
            balance_after=quantity,
            reason="shopify_sync",
            note="First Shopify inventory sync",
        )
        return item, True, True

    update_fields = []
    if item.shopify_inventory_item_id != shopify_inventory_item_id:
        item.shopify_inventory_item_id = shopify_inventory_item_id
        update_fields.append("shopify_inventory_item_id")
    if sku and item.sku != sku:
        item.sku = sku
        update_fields.append("sku")
    # Product name is filled in if we never had one (e.g. seeded blank by
    # import_skus_from_orders) but not overwritten once set, in case
    # someone renamed it locally on purpose.
    if not item.product_name and name:
        item.product_name = name
        update_fields.append("product_name")

    # Manual adjustments not yet pushed to Shopify (see
    # push_stock_changes_to_shopify) aren't in Shopify's count yet - keep
    # them on top of it, or a sync would silently wipe them from the
    # on-hand figure while they still wait in the push queue.
    target = quantity + item.pending_shopify_delta
    delta = target - item.quantity
    if delta != 0:
        item.quantity = target
        update_fields.append("quantity")

    if update_fields:
        item.save(update_fields=[*update_fields, "updated_at"])
    if delta != 0:
        StockMovement.all_objects.create(
            organization_id=organization_id,
            stock_item=item,
            delta=delta,
            balance_after=target,
            reason="shopify_sync",
            note="Shopify inventory sync",
        )
        return item, False, True
    return item, False, False


def sync_inventory_from_shopify(organization_id):
    """Pulls real on-hand quantities from Shopify for every variant in the
    catalogue (SKU or not) and writes them into wms.StockItem - the
    actual numbers, not the zero-seeded placeholder
    wms.services.import_skus_from_orders leaves behind (that function
    only discovers which SKUs exist from order history; it was never
    meant to be a source of real counts).

    Summed across every one of the store's locations into the org's
    single default warehouse - this app's stock model is one warehouse
    per org (see wms.services.get_default_warehouse), so a multi-location
    Shopify store's inventory is consolidated rather than mapped
    location-by-location, which would need a real location<->warehouse
    mapping this app doesn't have yet.
    """
    connection = ShopifyConnection.objects.filter(
        organization_id=organization_id, is_connected=True
    ).first()
    if not connection:
        raise InventorySyncError("Connect Shopify from the Integrations page first.")

    from wms.services import get_default_warehouse

    warehouse = get_default_warehouse(organization_id)
    if not warehouse:
        raise InventorySyncError("Set up a warehouse first (WMS page).")

    args = (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)

    # Every variant (sku may be "") -> its inventory_item_id (what stock
    # levels are actually keyed by) and a display name for the row.
    item_meta = {}
    for sku, inventory_item_id, name in shopify_client.iter_variant_skus(*args):
        if not inventory_item_id:
            continue
        item_meta[inventory_item_id] = {"sku": sku, "name": name}

    if not item_meta:
        return {"total_skus": 0, "created": 0, "updated": 0, "unchanged": 0}

    # Shopify caps inventory_item_ids at 100 per /inventory_levels.json
    # call, so a catalogue bigger than that has to be batched.
    item_ids = list(item_meta.keys())
    quantity_by_item_id = {}
    for start in range(0, len(item_ids), 100):
        batch = item_ids[start : start + 100]
        for level in shopify_client.fetch_inventory_levels(*args, batch):
            item_id = level.get("inventory_item_id")
            available = level.get("available")
            if item_id in item_meta and available is not None:
                quantity_by_item_id[item_id] = quantity_by_item_id.get(item_id, 0) + available

    created = updated = unchanged = 0
    for item_id, qty in quantity_by_item_id.items():
        meta = item_meta[item_id]
        _, was_created, qty_changed = _upsert_stock_item_from_shopify(
            organization_id, warehouse,
            shopify_inventory_item_id=item_id, sku=meta["sku"], name=meta["name"], quantity=qty,
        )
        if was_created:
            created += 1
        elif qty_changed:
            updated += 1
        else:
            unchanged += 1

    return {
        "total_skus": len(quantity_by_item_id),
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
    }


def sync_product_images_from_shopify(organization_id):
    """Every WMS stock item's Shopify image (StockItem.image_url) - the
    variant's own, else its product's first - matched by inventory item id,
    else by SKU. The Purchase Orders page shows it when adding a PO."""
    connection = ShopifyConnection.objects.filter(
        organization_id=organization_id, is_connected=True
    ).first()
    if not connection:
        raise InventorySyncError("Connect Shopify from the Integrations page first.")

    from wms.models import StockItem

    args = (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)
    by_item_id, by_sku = {}, {}
    for inventory_item_id, sku, src in shopify_client.iter_variant_images(*args):
        if not src:
            continue
        if inventory_item_id:
            by_item_id[inventory_item_id] = src
        if sku:
            by_sku.setdefault(sku, src)

    updated = 0
    for item in StockItem.objects.filter(organization_id=organization_id):
        src = (by_item_id.get(item.shopify_inventory_item_id) or by_sku.get(item.sku) or "")[:1000]
        if src and src != item.image_url:
            item.image_url = src
            item.save(update_fields=["image_url", "updated_at"])
            updated += 1
    return {"images_updated": updated}


def sync_stock_item_from_shopify_inventory_item(organization_id, inventory_item_id):
    """inventory_levels/update webhook handler - the payload only carries
    the new count at the one location that changed, and this app doesn't
    track a per-location breakdown (see sync_inventory_from_shopify), so
    this re-fetches the item's total across every location rather than
    trying to apply a partial delta. No-ops quietly if Shopify isn't
    connected or no warehouse exists yet - same as a webhook arriving for
    an org that hasn't finished setup.
    """
    connection = ShopifyConnection.objects.filter(
        organization_id=organization_id, is_connected=True
    ).first()
    if not connection:
        return None

    from wms.models import StockItem
    from wms.services import get_default_warehouse

    warehouse = get_default_warehouse(organization_id)
    if not warehouse:
        return None

    args = (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)
    levels = shopify_client.fetch_inventory_levels(*args, [inventory_item_id])
    quantity = sum(level.get("available") or 0 for level in levels if level.get("available") is not None)

    existing = StockItem.all_objects.filter(
        organization_id=organization_id, warehouse=warehouse,
        shopify_inventory_item_id=inventory_item_id,
    ).first()
    item, _, _ = _upsert_stock_item_from_shopify(
        organization_id, warehouse,
        shopify_inventory_item_id=inventory_item_id,
        sku=existing.sku if existing else "",
        name=existing.product_name if existing else "",
        quantity=quantity,
    )
    return item


def sync_stock_items_from_shopify_product_payload(organization_id, payload):
    """products/create + products/update webhook handler - keeps WMS
    stock items (name, sku, on-hand quantity) in step with the catalogue
    in real time, the same way orders/create + orders/updated already do
    for orders (see upsert_order_from_shopify). Unlike
    sync_inventory_from_shopify this only touches the variants in this
    one payload, not the whole store, so a new product shows up in WMS
    within moments of being created instead of waiting for the next
    manual Sync from Shopify click.
    """
    connection = ShopifyConnection.objects.filter(
        organization_id=organization_id, is_connected=True
    ).first()
    if not connection:
        return

    from wms.services import get_default_warehouse

    warehouse = get_default_warehouse(organization_id)
    if not warehouse:
        return

    title = (payload.get("title") or "").strip()
    item_meta = {}
    for variant in payload.get("variants") or []:
        inventory_item_id = variant.get("inventory_item_id")
        if not inventory_item_id:
            continue
        sku = (variant.get("sku") or "").strip()
        variant_title = (variant.get("title") or "").strip()
        name = title if variant_title in ("", "Default Title") else f"{title} - {variant_title}"
        item_meta[inventory_item_id] = {"sku": sku, "name": name}

    if not item_meta:
        return

    args = (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)
    quantity_by_item_id = {}
    for level in shopify_client.fetch_inventory_levels(*args, list(item_meta.keys())):
        item_id = level.get("inventory_item_id")
        available = level.get("available")
        if item_id in item_meta and available is not None:
            quantity_by_item_id[item_id] = quantity_by_item_id.get(item_id, 0) + available

    for item_id, meta in item_meta.items():
        _upsert_stock_item_from_shopify(
            organization_id, warehouse,
            shopify_inventory_item_id=item_id, sku=meta["sku"], name=meta["name"],
            quantity=quantity_by_item_id.get(item_id, 0),
        )


# --- WMS -> Shopify ("Push to Shopify" on the Inventory page) ---

# A claim older than this belongs to a request that died mid-push (worker
# restart, timeout) - it's released rather than blocking the row forever.
PUSH_CLAIM_TIMEOUT = timedelta(minutes=5)


class PushConflict(Exception):
    """The confirmed summary no longer matches what would be pushed - rows
    already being pushed elsewhere, or edited since the popup opened."""


def _connected_shopify(organization_id):
    connection = ShopifyConnection.objects.filter(
        organization_id=organization_id, is_connected=True
    ).first()
    if not connection:
        raise InventorySyncError("Connect Shopify from the Integrations page first.")
    return connection, (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)


def pending_push_queryset(organization_id):
    """Shopify-linked stock rows with a rename or stock delta waiting for
    Push to Shopify."""
    from django.db.models import Q

    from wms.models import StockItem

    return StockItem.all_objects.filter(
        organization_id=organization_id, shopify_inventory_item_id__isnull=False
    ).filter(~Q(pending_shopify_delta=0) | ~Q(pending_shopify_name=""))


def _shopify_totals(args, inventory_item_ids):
    """{inventory_item_id: available summed across locations} - the same
    consolidation sync_inventory_from_shopify uses."""
    totals = {}
    for start in range(0, len(inventory_item_ids), 100):
        for level in shopify_client.fetch_inventory_levels(*args, inventory_item_ids[start : start + 100]):
            available = level.get("available")
            if available is not None:
                item_id = level.get("inventory_item_id")
                totals[item_id] = totals.get(item_id, 0) + available
    return totals


def pending_shopify_changes(organization_id):
    """What "Push to Shopify" would send right now, for the confirmation
    popup. Each row's `expected` is echoed back by the push so it can
    refuse if anything changed after the user reviewed it. Shopify's live
    counts are fetched (batched, only for the pending rows) so the stock
    line shows the real before/after on Shopify; if that fails the summary
    still renders, just without those numbers."""
    _connection, args = _connected_shopify(organization_id)
    items = list(pending_push_queryset(organization_id).order_by("product_name", "sku"))

    live, live_error, totals = True, "", {}
    stock_ids = [i.shopify_inventory_item_id for i in items if i.pending_shopify_delta]
    if stock_ids:
        try:
            totals = _shopify_totals(args, stock_ids)
        except Exception as exc:  # noqa: BLE001 - preview still useful without live counts
            live, live_error = False, str(exc)[:300]

    claim_cutoff = timezone.now() - PUSH_CLAIM_TIMEOUT
    changes = []
    for item in items:
        lines = []
        if item.pending_shopify_name:
            lines.append({
                "type": "title",
                "label": "Product name changed",
                "from": item.previous_shopify_name,
                "to": item.pending_shopify_name,
            })
        if item.pending_shopify_delta:
            before = totals.get(item.shopify_inventory_item_id) if live else None
            increase = item.pending_shopify_delta > 0
            lines.append({
                "type": "stock_increase" if increase else "stock_decrease",
                "label": "Stock added (manual adjustment)" if increase else "Stock removed (manual adjustment)",
                "delta": item.pending_shopify_delta,
                "from": before,
                "to": before + item.pending_shopify_delta if before is not None else None,
            })
        changes.append({
            "id": str(item.id),
            "sku": item.sku,
            "product_name": item.product_name,
            "wms_quantity": item.quantity,
            "expected": {"delta": item.pending_shopify_delta, "name": item.pending_shopify_name},
            "changes": lines,
            "last_error": item.shopify_push_error,
            "in_progress": bool(item.shopify_push_started_at and item.shopify_push_started_at > claim_cutoff),
        })
    return {"changes": changes, "live": live, "live_error": live_error}


def _shopify_title_for(name, context):
    """WMS names a variant row "<product> - <variant>" (see
    shopify_client.iter_variant_skus), but on Shopify that's a product
    title shared by every variant plus the variant's own title - so the
    product title is only derivable when that suffix is kept."""
    if context["has_only_default_variant"]:
        return name
    suffix = f" - {context['variant_title']}"
    if name.endswith(suffix) and name[: -len(suffix)].strip():
        return name[: -len(suffix)].strip()
    raise shopify_client.ShopifyAPIError(
        f'This SKU is the "{context["variant_title"]}" variant of a multi-variant product - '
        f'keep the name ending in "{suffix}" so the product title can be updated'
    )


def _push_one_item(item, args, primary_location_id):
    """Sends one row's pending rename and/or stock delta. Returns
    (pushed_name, pushed_delta, lines, errors) - each change succeeds or
    fails on its own, so a rejected rename doesn't hold back the stock."""
    name, delta = item.pending_shopify_name, item.pending_shopify_delta
    pushed_name, pushed_delta, lines, errors = None, 0, [], []

    try:
        context = shopify_client.fetch_inventory_item_context(*args, item.shopify_inventory_item_id)
        if context is None:
            raise shopify_client.ShopifyAPIError("This product no longer exists on Shopify")
    except Exception as exc:  # noqa: BLE001 - reported per row, kept for retry
        message = str(exc)[:300]
        if name:
            lines.append({"type": "title", "success": False, "error": message})
        if delta:
            lines.append({"type": "stock", "success": False, "error": message})
        return None, 0, lines, [message]

    if name:
        try:
            title = _shopify_title_for(name, context)[:255]
            if title != context["product_title"]:
                shopify_client.update_product_title(*args, context["product_id"], title)
            pushed_name = name
            lines.append({"type": "title", "success": True})
        except Exception as exc:  # noqa: BLE001
            message = str(exc)[:300]
            errors.append(f"Name: {message}")
            lines.append({"type": "title", "success": False, "error": message})

    if delta:
        location_ids = [level["location_id"] for level in context["levels"] if level["location_id"]]
        if primary_location_id in location_ids:
            location_id = primary_location_id
        else:
            location_id = location_ids[0] if location_ids else None
        try:
            if location_id is None:
                raise shopify_client.ShopifyAPIError("Not stocked at any Shopify location")
            shopify_client.adjust_inventory_level(
                *args,
                inventory_item_id=item.shopify_inventory_item_id,
                location_id=location_id,
                adjustment=delta,
            )
            pushed_delta = delta
            lines.append({"type": "stock", "success": True})
        except Exception as exc:  # noqa: BLE001
            message = str(exc)[:300]
            errors.append(f"Stock: {message}")
            lines.append({"type": "stock", "success": False, "error": message})

    return pushed_name, pushed_delta, lines, errors


def push_stock_changes_to_shopify(organization_id, expected_changes, *, actor_user_id=None):
    """One batch of "Push to Shopify". `expected_changes` is
    [{id, delta, name}] exactly as the confirmation popup showed them
    (pending_shopify_changes' `expected`); the page sends the confirmed
    list a few rows at a time, the same way "Push all statuses now" does,
    so no request runs long against Shopify's ~2 requests/second.

    Rows are claimed up front, so a double click or second tab can't send
    a delta twice, and the whole batch is refused (PushConflict) if any
    row changed since it was reviewed. Afterwards only what actually went
    through is cleared - and by subtracting the pushed delta rather than
    zeroing it, so an adjustment made while the push was in flight stays
    pending. Failures keep their pending change for a retry.
    """
    from django.db import transaction

    from wms.models import StockItem

    connection, args = _connected_shopify(organization_id)
    wanted = {}
    for change in expected_changes:
        try:
            wanted[str(change["id"])] = (int(change.get("delta") or 0), str(change.get("name") or ""))
        except (AttributeError, KeyError, TypeError, ValueError):
            raise PushConflict("Malformed change list - reopen Push to Shopify and try again.")
    if not wanted:
        return {"results": [], "pushed": 0, "failed": 0}

    now = timezone.now()
    with transaction.atomic():
        rows = {
            str(row.id): row
            for row in StockItem.all_objects.select_for_update().filter(
                organization_id=organization_id, id__in=list(wanted), shopify_inventory_item_id__isnull=False
            )
        }
        for item_id, (delta, name) in wanted.items():
            row = rows.get(item_id)
            if (
                row is None
                or not (delta or name)
                or (row.pending_shopify_delta, row.pending_shopify_name) != (delta, name)
            ):
                raise PushConflict("Some changes were edited since you opened the summary - review them again.")
            if row.shopify_push_started_at and row.shopify_push_started_at > now - PUSH_CLAIM_TIMEOUT:
                raise PushConflict("These changes are already being pushed - wait for that push to finish.")
        StockItem.all_objects.filter(id__in=list(rows)).update(shopify_push_started_at=now)

    try:
        primary_location_id = shopify_client.fetch_shop_info(*args).get("primary_location_id")
    except Exception:  # noqa: BLE001 - fall back to the item's first stocked location
        primary_location_id = None

    results, reconcile = [], []
    with shopify_client.wait_out_rate_limits():
        for item_id in wanted:
            item = rows[item_id]
            try:
                pushed_name, pushed_delta, lines, errors = _push_one_item(item, args, primary_location_id)
            except Exception as exc:  # noqa: BLE001 - never leave a row claimed
                pushed_name, pushed_delta, lines, errors = None, 0, [], [str(exc)[:300]]

            with transaction.atomic():
                fresh = StockItem.all_objects.select_for_update().get(pk=item.pk)
                fresh.shopify_push_started_at = None
                if pushed_name is not None and fresh.pending_shopify_name == pushed_name:
                    fresh.pending_shopify_name = ""
                    fresh.previous_shopify_name = ""
                fresh.pending_shopify_delta -= pushed_delta
                if pushed_name is not None or pushed_delta:
                    fresh.last_pushed_to_shopify_at = timezone.now()
                fresh.shopify_push_error = "; ".join(errors)[:500]
                fresh.save(update_fields=[
                    "shopify_push_started_at", "pending_shopify_name", "previous_shopify_name",
                    "pending_shopify_delta", "last_pushed_to_shopify_at", "shopify_push_error", "updated_at",
                ])
            if pushed_delta:
                reconcile.append(fresh)
            results.append({
                "id": item_id,
                "sku": item.sku,
                "product_name": item.product_name,
                "success": not errors,
                "changes": lines,
                "errors": errors,
            })

    # Re-read Shopify's totals for what was just adjusted, so the on-hand
    # figure here matches Shopify (plus anything still pending) even if an
    # inventory webhook landed between the adjust and the pending update.
    if reconcile:
        try:
            from wms.services import get_default_warehouse

            warehouse = get_default_warehouse(organization_id)
            totals = _shopify_totals(args, [i.shopify_inventory_item_id for i in reconcile])
            for item in reconcile:
                if warehouse and item.warehouse_id == warehouse.id and item.shopify_inventory_item_id in totals:
                    _upsert_stock_item_from_shopify(
                        organization_id, warehouse,
                        shopify_inventory_item_id=item.shopify_inventory_item_id,
                        sku=item.sku, name=item.product_name,
                        quantity=totals[item.shopify_inventory_item_id],
                    )
        except Exception:  # noqa: BLE001 - the push itself succeeded; the next sync reconciles
            logger.exception("Post-push inventory reconcile failed for org %s", organization_id)

    pushed = sum(1 for r in results if r["success"])
    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=organization_id,
            action="wms.shopify_push",
            summary=f"Pushed {pushed} of {len(results)} inventory change(s) to Shopify ({connection.shop_domain})",
            actor_user_id=actor_user_id,
            entity_type="stock_item",
            entity_id="",
            metadata={"results": [{k: r[k] for k in ("sku", "success", "errors")} for r in results]},
        )
    except Exception:  # noqa: BLE001
        pass
    return {"results": results, "pushed": pushed, "failed": len(results) - pushed}


MAX_PRODUCT_IMAGES = 10
MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024
PRODUCT_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def create_stock_item_on_shopify(
    organization_id, *, sku, name, price, quantity, reorder_level=0, images=(), actor_user_id=None
):
    """"Add Stock Item" with "Also create on Shopify": creates an active
    single-variant product (name, SKU, price, images) on the connected
    store, then the WMS row linked to it in the default warehouse - the one
    every Shopify sync writes to.

    The opening quantity goes out the same way Push to Shopify sends stock
    (queued as a pending delta, then adjusted at the primary location), so
    if that step fails the product still exists and the row just shows
    "Push failed" for a retry from the Push button. Returns (item, warning).
    """
    from wms.models import StockItem, StockMovement
    from wms.services import get_default_warehouse

    connection, args = _connected_shopify(organization_id)
    warehouse = get_default_warehouse(organization_id)
    if not warehouse:
        raise InventorySyncError("Set up a warehouse first (WMS page).")
    if StockItem.all_objects.filter(organization_id=organization_id, sku=sku).exists():
        raise InventorySyncError(f'SKU "{sku}" is already in your inventory - every product needs its own SKU.')
    if len(images) > MAX_PRODUCT_IMAGES:
        raise InventorySyncError(f"Add at most {MAX_PRODUCT_IMAGES} images.")
    for image in images:
        if image.content_type not in PRODUCT_IMAGE_TYPES:
            raise InventorySyncError(f"{image.name}: use a JPG, PNG, WEBP or GIF image.")
        if image.size > MAX_PRODUCT_IMAGE_BYTES:
            raise InventorySyncError(f"{image.name} is larger than 5 MB.")

    with shopify_client.wait_out_rate_limits():
        try:
            existing = shopify_client.find_variant_by_sku(*args, sku)
            if existing:
                raise InventorySyncError(
                    f'SKU "{sku}" is already used on Shopify by "{existing["product_title"]}" - '
                    "sync from Shopify instead, or pick another SKU."
                )
            sources = [
                shopify_client.upload_product_image(
                    *args, filename=image.name, content_type=image.content_type, content=image.read()
                )
                for image in images
            ]
            created = shopify_client.create_product(*args, title=name, sku=sku, price=price, image_sources=sources)
        except shopify_client.ShopifyAPIError as exc:
            raise InventorySyncError(str(exc)[:500]) from exc

        # update_or_create: on live, Shopify's products/create webhook can
        # land first and create this row at zero.
        item, _ = StockItem.all_objects.update_or_create(
            organization_id=organization_id,
            warehouse=warehouse,
            shopify_inventory_item_id=created["inventory_item_id"],
            defaults={
                "sku": sku,
                "product_name": name,
                "reorder_level": reorder_level,
                "quantity": quantity,
                "pending_shopify_delta": quantity,
            },
        )
        StockMovement.all_objects.create(
            organization_id=organization_id,
            stock_item=item,
            delta=quantity,
            balance_after=quantity,
            reason="initial",
            note="Opening stock - product created on Shopify",
            actor_user_id=actor_user_id,
        )

        warning = ""
        if quantity:
            try:
                location_id = shopify_client.fetch_shop_info(*args).get("primary_location_id")
                shopify_client.activate_inventory_at_location(
                    *args, inventory_item_id=created["inventory_item_id"], location_id=location_id
                )
                shopify_client.adjust_inventory_level(
                    *args, inventory_item_id=created["inventory_item_id"], location_id=location_id,
                    adjustment=quantity,
                )
                StockItem.all_objects.filter(pk=item.pk).update(
                    pending_shopify_delta=F("pending_shopify_delta") - quantity,
                    last_pushed_to_shopify_at=timezone.now(),
                    shopify_push_error="",
                )
            except Exception as exc:  # noqa: BLE001 - product exists; stock stays queued for Push
                warning = (
                    "The product was created on Shopify, but its opening stock couldn't be set "
                    f"({str(exc)[:200]}). Use Push to Shopify to retry."
                )
                StockItem.all_objects.filter(pk=item.pk).update(shopify_push_error=f"Stock: {str(exc)[:480]}")
        item.refresh_from_db()

    try:
        from core.rbac import write_audit_log

        write_audit_log(
            organization_id=organization_id,
            action="wms.shopify_product_create",
            summary=f'Created "{name}" ({sku}) on Shopify ({connection.shop_domain}) with {quantity} in stock',
            actor_user_id=actor_user_id,
            entity_type="stock_item",
            entity_id=str(item.id),
            metadata={"sku": sku, "price": str(price), "images": len(images), "product_id": created["product_id"]},
        )
    except Exception:  # noqa: BLE001
        pass
    return item, warning
