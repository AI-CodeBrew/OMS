from django.db import migrations

# One-off: close every gap in the OMS Order ID (supabase_order_no). Every
# order in the database - whichever store it belongs to - is numbered
# 1, 2, 3, ... N, where N is the number of orders, in the order they
# already had (lowest current OMS ID first; any order without one goes
# last, oldest first). Nothing changes places - only the holes left by
# failed inserts and deleted orders close up. The counter from 0044 then
# continues at N + 1, gapless from there on.
#
# IDs DO change: anything that stored the old numbers outside the database
# (the Google Sheets order feed, notes, screenshots) no longer matches. The
# feed's incremental sync (updated_since) won't notice - updated_at is left
# alone on purpose - so re-pull the sheet in full once afterwards.
#
# Not reversible: the old numbers aren't kept anywhere.

RENUMBER = """
    -- No order can be inserted (and take a number) while this runs. Reads
    -- carry on; inserts wait the few seconds it takes.
    LOCK TABLE oms.orders IN SHARE ROW EXCLUSIVE MODE;
    SELECT last_value FROM oms.oms_order_no_counter WHERE id = 1 FOR UPDATE;

    -- Step 1: move every number far out of the way, so step 2 never sets a
    -- value another row still holds (the unique index is checked row by
    -- row). Adding a constant keeps them unique.
    UPDATE oms.orders
    SET supabase_order_no = supabase_order_no + 1000000000
    WHERE supabase_order_no IS NOT NULL;

    -- Step 2: 1..N in the existing order.
    UPDATE oms.orders o
    SET supabase_order_no = numbered.rn
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY supabase_order_no ASC NULLS LAST, created_at ASC, id ASC) AS rn
        FROM oms.orders
    ) numbered
    WHERE o.id = numbered.id;

    -- The next order gets N + 1.
    UPDATE oms.oms_order_no_counter
    SET last_value = COALESCE((SELECT MAX(supabase_order_no) FROM oms.orders), 0)
    WHERE id = 1;

    -- Keep the old (unused) sequence past every number too, in case 0044
    -- is ever reversed back onto it.
    SELECT setval(
        'oms.orders_supabase_no_seq',
        COALESCE((SELECT MAX(supabase_order_no) FROM oms.orders), 0) + 1,
        false
    );
"""


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0044_gapless_oms_order_id"),
    ]

    operations = [
        migrations.RunSQL(sql=RENUMBER, reverse_sql=migrations.RunSQL.noop),
    ]
