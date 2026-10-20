from django.db import migrations, models

# Existing orders that already have a tracking number get booked_at from the
# best record of when the booking landed: the courier shipment row made at
# booking time (PostEx/BarqRaftar), else the first move into Awaiting
# Booking / Ready to Print, else when it was dispatched. Left null when none
# of those exist - better blank than a made-up time.
BACKFILL = """
    UPDATE oms.orders o
    SET booked_at = COALESCE(
        (SELECT MIN(s.booked_at) FROM postex_integrations.shipments s
          WHERE s.order_id = o.id AND s.tracking_number <> ''),
        (SELECT MIN(s.booked_at) FROM barqraftar_integrations.shipments s
          WHERE s.order_id = o.id AND s.tracking_number <> ''),
        (SELECT MIN(e.created_at) FROM oms.order_status_events e
          WHERE e.order_id = o.id AND e.to_status IN ('booking_pending', 'ready_to_print')),
        o.dispatched_at
    )
    WHERE o.tracking_number <> '' AND o.booked_at IS NULL;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0031_backfill_missing_oms_order_ids"),
        # The shipment tables the backfill reads.
        ("integrations", "0024_omscourierenrollment_details"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="booked_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="order",
            name="customer_note",
            field=models.TextField(blank=True, db_default="", default=""),
        ),
        migrations.RunSQL(BACKFILL, migrations.RunSQL.noop),
    ]
