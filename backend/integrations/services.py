from decimal import Decimal, InvalidOperation

from core.events import publish_event
from oms.models import Order, OrderItem


def _to_decimal(value):
    try:
        return Decimal(str(value)) if value is not None else Decimal("0")
    except InvalidOperation:
        return Decimal("0")


def upsert_order_from_shopify(organization_id, shopify_order):
    """Create or update an oms.Order from a Shopify order payload (webhook
    or REST sync - same shape either way). Runs outside normal
    JWT-authenticated request context (webhooks carry no Supabase JWT), so
    it always uses the unscoped `all_objects` manager and passes
    organization_id explicitly rather than relying on ambient tenant
    context."""
    shopify_order_id = shopify_order["id"]
    customer = shopify_order.get("customer") or {}
    customer_name = (
        " ".join(filter(None, [customer.get("first_name"), customer.get("last_name")])).strip()
        or shopify_order.get("email")
        or "Unknown"
    )
    phone = shopify_order.get("phone") or customer.get("phone") or ""

    if shopify_order.get("cancelled_at"):
        status = "cancelled"
    elif shopify_order.get("fulfillment_status") == "fulfilled":
        status = "fulfilled"
    else:
        status = "pending"

    order_number = shopify_order.get("name") or f"#{shopify_order.get('order_number', shopify_order_id)}"

    order, created = Order.all_objects.update_or_create(
        organization_id=organization_id,
        shopify_order_id=shopify_order_id,
        defaults={
            "order_number": order_number,
            "customer_name": customer_name,
            "customer_phone": phone,
            "status": status,
            "total_amount": _to_decimal(shopify_order.get("total_price")),
        },
    )

    # Line items can change between webhook deliveries (edited orders) -
    # full replace is simpler and safer than diffing.
    OrderItem.all_objects.filter(order=order).delete()
    for line_item in shopify_order.get("line_items", []):
        OrderItem.all_objects.create(
            organization_id=organization_id,
            order=order,
            product_name=line_item.get("title") or "Item",
            quantity=line_item.get("quantity") or 1,
            unit_price=_to_decimal(line_item.get("price")),
        )

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
