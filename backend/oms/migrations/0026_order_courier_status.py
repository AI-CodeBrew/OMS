from django.db import migrations, models


def backfill_from_shipments(apps, schema_editor):
    """Orders PostEx or BarqRaftar already track start out with the status
    their courier last reported, instead of blank until the next poll."""
    Order = apps.get_model("oms", "Order")
    labels = {}
    for model_name in ("BarqRaftarShipment", "PostExShipment"):
        Shipment = apps.get_model("integrations", model_name)
        rows = (
            Shipment.objects.filter(is_active=True)
            .exclude(status_label="")
            .values_list("order_id", "status_label")
        )
        for order_id, label in rows.iterator():
            labels[order_id] = label[:100]

    by_label = {}
    for order_id, label in labels.items():
        by_label.setdefault(label, []).append(order_id)
    for label, order_ids in by_label.items():
        for start in range(0, len(order_ids), 1000):
            Order.objects.filter(id__in=order_ids[start:start + 1000]).update(courier_status=label)


class Migration(migrations.Migration):

    dependencies = [
        ('oms', '0025_order_platform_reference'),
        # The PostEx and BarqRaftar shipment tables the backfill reads.
        ('integrations', '0020_postex'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='courier_status',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.RunPython(backfill_from_shipments, migrations.RunPython.noop),
    ]
