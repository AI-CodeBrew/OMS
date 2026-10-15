from django.db import migrations, models


def backfill(apps, schema_editor):
    """Marks the orders the Dispatch Hub already booked. Nothing recorded
    that at the time, but every booking passes through Booking Pending, and
    its status event names who booked it: a Hub booking is made by a
    FynkTech admin, who isn't a member of the store. An order's latest such
    event decides."""
    OrderStatusEvent = apps.get_model("oms", "OrderStatusEvent")
    Order = apps.get_model("oms", "Order")
    Membership = apps.get_model("core", "Membership")

    members = set(
        (str(org_id), str(user_id))
        for org_id, user_id in Membership.objects.values_list("organization_id", "user_id")
    )
    latest = {}
    events = (
        OrderStatusEvent.objects.filter(to_status="booking_pending", actor_user_id__isnull=False)
        .order_by("created_at")
        .values_list("order_id", "organization_id", "actor_user_id", "created_at")
    )
    for order_id, org_id, actor, created_at in events.iterator():
        latest[order_id] = (org_id, actor, created_at)

    for order_id, (org_id, actor, created_at) in latest.items():
        if (str(org_id), str(actor)) not in members:
            Order.objects.filter(id=order_id, hub_dispatched_at__isnull=True).update(
                hub_dispatched_at=created_at
            )


class Migration(migrations.Migration):
    """Order.hub_dispatched_at - when the Dispatch Hub booked the order (the
    "by FynkTech" tag). Nullable, so backend code that predates it (on the
    same database) keeps inserting orders without it."""

    dependencies = [
        ('oms', '0028_order_courier_charges'),
        ('core', '0007_notification_courier_request'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='hub_dispatched_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
