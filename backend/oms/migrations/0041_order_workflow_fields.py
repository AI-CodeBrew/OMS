from django.db import migrations, models

# Orders already out with the courier: count their past moves into Out for
# Delivery, so a parcel on its second attempt doesn't start back at zero.
BACKFILL_ATTEMPTS = """
    UPDATE oms.orders o
    SET delivery_attempts = LEAST(e.n, 32767)
    FROM (
        SELECT order_id, COUNT(*) AS n
        FROM oms.order_status_events
        WHERE to_status = 'out_for_delivery' AND from_status <> 'out_for_delivery'
        GROUP BY order_id
    ) e
    WHERE e.order_id = o.id;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0040_dispatch_batches"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="delivery_attempts",
            field=models.PositiveSmallIntegerField(db_default=0, default=0),
        ),
        migrations.AddField(
            model_name="order",
            name="workflow_flag",
            field=models.CharField(blank=True, db_default="", default="", max_length=40),
        ),
        migrations.RunSQL(BACKFILL_ATTEMPTS, reverse_sql=migrations.RunSQL.noop),
        # Label only (no database change): awaiting_assigning now sits under
        # the Approved card.
        migrations.AlterField(
            model_name="order",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("pending_cc", "Pending CC"),
                    ("pending_cod", "Pending COD"),
                    ("city_issue", "City Issue"),
                    ("awaiting_assigning", "Approved (Awaiting Courier)"),
                    ("awaiting_approval", "Awaiting Confirmation"),
                    ("approved", "Approved"),
                    ("booking_pending", "Awaiting Booking"),
                    ("ready_to_print", "Ready to Print"),
                    ("ready_to_pick", "Ready to Pick"),
                    ("dispatch_issue", "Dispatch Issue"),
                    ("awaiting_dispatched", "Awaiting Dispatched"),
                    ("dispatched", "Dispatched"),
                    ("out_for_delivery", "Out for Delivery"),
                    ("attempt", "Delivery Attempt Failed"),
                    ("delivered", "Delivered"),
                    ("cancelled", "Cancelled"),
                    ("returned", "Returned"),
                ],
                default="pending_cod",
                max_length=30,
            ),
        ),
    ]
