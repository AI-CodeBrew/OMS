import django.db.models.expressions
from django.db import migrations, models

from core.rls import platform_admin_only_policy_sql

# OMS Order ID without gaps. The old default, nextval() on
# oms.orders_supabase_no_seq, takes its number before the INSERT runs and
# a sequence never rolls back - so every failed insert (a Shopify order
# whose order number already exists, retried by Shopify again and again; a
# CSV import row; ...) burned a number for good.
#
# Now the number comes from a one-row counter table, bumped by an UPDATE
# inside the INSERT itself (the column's default calls
# oms.next_oms_order_no()). If the INSERT fails, the UPDATE is rolled back
# with it, so the number is handed out again to the next order that does
# get saved. Saved orders therefore number 1, 2, 3, ... with no gaps from
# here on (old gaps stay until the existing orders are renumbered).
#
# The row lock is held until the inserting transaction commits, so order
# inserts take turns - fine at this volume, and exactly what makes it
# gapless.
#
# The old sequence is left in place: models._next_supabase_order_no (still
# imported by migration 0023) reads it, and nothing else does any more.

CREATE = """
    CREATE TABLE IF NOT EXISTS oms.oms_order_no_counter (
        id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        last_value integer NOT NULL
    );
    INSERT INTO oms.oms_order_no_counter (id, last_value)
    VALUES (1, COALESCE((SELECT MAX(supabase_order_no) FROM oms.orders), 0))
    ON CONFLICT (id) DO UPDATE
        SET last_value = GREATEST(oms.oms_order_no_counter.last_value, EXCLUDED.last_value);

    -- SECURITY DEFINER: the counter is locked down by RLS below, but any
    -- role allowed to insert an order must still get its number.
    CREATE OR REPLACE FUNCTION oms.next_oms_order_no() RETURNS integer
        LANGUAGE sql VOLATILE SECURITY DEFINER
        SET search_path = oms, pg_temp
    AS $$
        UPDATE oms.oms_order_no_counter SET last_value = last_value + 1 WHERE id = 1
        RETURNING last_value
    $$;
"""

DROP = """
    DROP FUNCTION IF EXISTS oms.next_oms_order_no();
    DROP TABLE IF EXISTS oms.oms_order_no_counter;
"""

# Going back to the sequence: move it past every number the counter gave
# out, so nextval() can't hand out one that's already taken.
RESYNC_SEQUENCE = """
    SELECT setval(
        'oms.orders_supabase_no_seq',
        COALESCE((SELECT MAX(supabase_order_no) FROM oms.orders), 0) + 1,
        false
    );
"""


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0043_order_shipper_advice"),
    ]

    operations = [
        migrations.RunSQL(sql=CREATE, reverse_sql=DROP),
        migrations.RunSQL(
            sql=platform_admin_only_policy_sql("oms", "oms_order_no_counter"),
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.RunSQL(sql=migrations.RunSQL.noop, reverse_sql=RESYNC_SEQUENCE),
        migrations.AlterField(
            model_name="order",
            name="supabase_order_no",
            field=models.PositiveIntegerField(
                blank=True,
                db_default=django.db.models.expressions.RawSQL("oms.next_oms_order_no()", []),
                editable=False,
                null=True,
                unique=True,
            ),
        ),
    ]
