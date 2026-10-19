from django.db import migrations

# Orders created between 0023 running on production and the code that sets
# supabase_order_no being deployed (22 Sep 2026, ~4 hours) were inserted by
# the old code and got no OMS Order ID. Number them from the same sequence,
# oldest first, so they continue the series without clashing - and give the
# column a database default from that sequence, so a deploy window like
# that can't leave an order without one again (the ORM's Python default,
# _next_supabase_order_no, still supplies the value for normal inserts).
BACKFILL = """
    UPDATE oms.orders o
    SET supabase_order_no = numbered.no
    FROM (
        SELECT id, nextval('oms.orders_supabase_no_seq') AS no
        FROM (SELECT id FROM oms.orders WHERE supabase_order_no IS NULL ORDER BY created_at, id) oldest_first
    ) numbered
    WHERE o.id = numbered.id;

    ALTER TABLE oms.orders
        ALTER COLUMN supabase_order_no SET DEFAULT nextval('oms.orders_supabase_no_seq');
"""

UNDO = "ALTER TABLE oms.orders ALTER COLUMN supabase_order_no DROP DEFAULT;"


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0030_rename_status_labels"),
    ]

    operations = [
        migrations.RunSQL(sql=BACKFILL, reverse_sql=UNDO),
    ]
