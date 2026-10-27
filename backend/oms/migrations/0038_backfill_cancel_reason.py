from django.db import migrations

# Orders cancelled before cancel_reason existed: the reason was only ever
# written as the note on their move to Cancelled (OrderStatusEvent) - copy
# the latest such note in. Orders with no note stay blank (Shopify-cancelled
# ones get Shopify's reason on their next sync).
BACKFILL = """
    UPDATE oms.orders o
    SET cancel_reason = LEFT(e.note, 255)
    FROM (
        SELECT DISTINCT ON (order_id) order_id, note
        FROM oms.order_status_events
        WHERE to_status = 'cancelled' AND note <> ''
        ORDER BY order_id, created_at DESC
    ) e
    WHERE e.order_id = o.id AND o.status = 'cancelled' AND o.cancel_reason = '';
"""


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0037_order_cancel_reason"),
    ]

    operations = [
        migrations.RunSQL(BACKFILL, reverse_sql=migrations.RunSQL.noop),
    ]
