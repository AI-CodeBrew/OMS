"""Event listeners for the oms app.

Order change log: every save of an order - by a person on any screen, a
bulk action, a courier's poller or webhook, a Shopify sync - is compared
with the values it was loaded with, and whatever changed goes to the Logs
tab (core.OrganizationAuditLog) as one row per order: "Order #1042: Tag:
- -> VIP; City: Lhr -> Lahore". Status changes aren't repeated here - every
transition already writes its own row (services._apply_transition).

Writes that skip Order.save() (queryset .update()) are invisible to this;
the ones a person would care about log themselves (flag_stock_shortages,
mark_packed).

Other apps' events: subscribe the same way as below when one is needed:

    from core.events import subscribe
    subscribe("some.event", handler)
"""

import logging
from decimal import Decimal

from django.db.models.signals import post_init, post_save
from django.dispatch import receiver

from .models import Order

logger = logging.getLogger(__name__)

# Fields a person would want to see changed, by their Logs label. Internal
# bookkeeping (sync stamps, Shopify ids, updated_at, ...) is left out, and
# so is status (see above).
LOGGED_FIELDS = {
    "order_number": "Order number",
    "customer_name": "Customer name",
    "customer_phone": "Phone",
    "secondary_phone": "Secondary phone",
    "customer_email": "Email",
    "address_line1": "Address",
    "address_line2": "Address line 2",
    "city": "City",
    "postal_code": "Postal code",
    "country": "Country",
    "cnic": "CNIC",
    "payment_gateway": "Payment method",
    "payment_status": "Payment status",
    "amount_paid": "Amount paid",
    "fulfillment_status": "Fulfillment",
    "total_amount": "Total",
    "shipping_amount": "Shipping",
    "coupon_discount": "Discount",
    "gift_card_discount": "Gift card",
    "courier_id": "Courier",
    "tracking_number": "Tracking number",
    "courier_status": "Sub status",
    "courier_charges": "Courier charges",
    "invoice_number": "Invoice number",
    "tag": "Tag",
    "workflow_flag": "Workflow tag",
    "cancel_reason": "Cancel reason",
    "issue_note": "Issue note",
    "return_reason": "Return reason",
    "return_in_progress_at": "Return in progress",
    "return_condition": "Return condition",
    "shipper_advice": "Shipper advice",
    "shipper_advice_remarks": "Shipper advice remarks",
    "packed_at": "Packed",
    "dispatch_requested_at": "Sent for dispatch",
    "delivery_attempts": "Delivery attempts",
    "customer_note": "Customer note",
    "expected_delivery_date": "Expected delivery",
    "preferred_courier": "Preferred courier",
    "risk_status": "Risk status",
}

_MISSING = object()


def _snapshot(instance):
    # Only what was actually loaded - reading a deferred field here would
    # cost a query per order.
    return {f: instance.__dict__.get(f, _MISSING) for f in LOGGED_FIELDS}


@receiver(post_init, sender=Order)
def _remember_loaded_values(sender, instance, **kwargs):
    instance._logged_values = _snapshot(instance)


def _shown(field, value):
    if value is None or value == "":
        return "-"
    if field == "courier_id":
        from .models import Courier

        name = Courier.all_objects.filter(id=value).values_list("name", flat=True).first()
        return name or "-"
    if field.endswith("_at"):
        return "set" if value else "-"
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    text = str(value)
    return text if len(text) <= 60 else text[:57] + "..."


@receiver(post_save, sender=Order)
def _log_order_changes(sender, instance, created, update_fields=None, **kwargs):
    before = getattr(instance, "_logged_values", {})
    after = _snapshot(instance)
    instance._logged_values = after
    if created:
        return  # a new order is logged where it's created
    changes = {}
    for field, old in before.items():
        new = after.get(field, _MISSING)
        if old is _MISSING or new is _MISSING or old == new:
            continue
        if update_fields is not None and field not in update_fields:
            continue
        # "" and None both mean empty - not a change.
        if old in (None, "") and new in (None, ""):
            continue
        changes[field] = (old, new)
    if not changes:
        return
    try:
        from core.context import current_request_meta
        from core.rbac import write_audit_log

        parts = [
            f"{LOGGED_FIELDS[f]}: {_shown(f, old)} → {_shown(f, new)}" for f, (old, new) in changes.items()
        ]
        # write_audit_log marks the request as logged, which would drop its
        # own request row (e.g. "Bulk update tag on orders") - keep both.
        meta = current_request_meta.get() or {}
        already = meta.get("audited")
        write_audit_log(
            organization_id=instance.organization_id,
            action="order.updated",
            summary=f"Order {instance.order_number}: " + "; ".join(parts),
            entity_type="order",
            entity_id=str(instance.id),
            metadata={
                "order_number": instance.order_number,
                "changes": {f: [_shown(f, old), _shown(f, new)] for f, (old, new) in changes.items()},
            },
        )
        if meta:
            meta["audited"] = already
    except Exception:
        logger.exception("Failed to log changes to order %s", instance.order_number)
