from django.db import migrations

STATUS_MAP = {
    "pending": "pending_cod",
    "confirmed": "awaiting_assigning",
    "fulfilled": "dispatched",
    "cancelled": "cancelled",
}


def remap_forward(apps, schema_editor):
    Order = apps.get_model("oms", "Order")
    for old_status, new_status in STATUS_MAP.items():
        if old_status != new_status:
            Order.objects.filter(status=old_status).update(status=new_status)


def remap_backward(apps, schema_editor):
    Order = apps.get_model("oms", "Order")
    reverse_map = {
        "pending_cod": "pending",
        "pending_cc": "pending",
        "awaiting_assigning": "confirmed",
        "dispatched": "fulfilled",
        "delivered": "fulfilled",
        "cancelled": "cancelled",
    }
    for new_status, old_status in reverse_map.items():
        Order.objects.filter(status=new_status).update(status=old_status)


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0003_order_city_order_delivered_at_order_dispatched_at_and_more"),
    ]

    operations = [
        migrations.RunPython(remap_forward, remap_backward),
    ]
