from django.db import migrations, models

import oms.models


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0022_order_shopify_fulfillment_id"),
    ]

    operations = [
        # A real Postgres sequence, not app-level counting - see
        # oms.models._next_supabase_order_no for why.
        migrations.RunSQL(
            sql="CREATE SEQUENCE IF NOT EXISTS oms.orders_supabase_no_seq;",
            reverse_sql="DROP SEQUENCE IF EXISTS oms.orders_supabase_no_seq;",
        ),
        # Deliberately added with NO default and NO unique constraint yet -
        # Django's AddField evaluates a field's `default` exactly *once* and
        # uses that single value to backfill every existing row before
        # applying constraints (confirmed the hard way: it tried to write
        # the same nextval() result into all ~10,271 rows, then failed
        # building the unique index on an all-duplicate column). Adding it
        # bare first means every existing row just gets NULL, which is
        # always valid.
        migrations.AddField(
            model_name="order",
            name="supabase_order_no",
            field=models.PositiveIntegerField(blank=True, editable=False, null=True),
        ),
        # Backfill every existing row oldest-first (1 = the very first order
        # ever created), then move the sequence past the highest number
        # handed out here so the next *new* order's nextval() continues
        # cleanly instead of colliding with a backfilled row.
        migrations.RunSQL(
            sql="""
                UPDATE oms.orders o
                SET supabase_order_no = sub.rn
                FROM (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
                    FROM oms.orders
                ) sub
                WHERE o.id = sub.id;

                SELECT setval(
                    'oms.orders_supabase_no_seq',
                    COALESCE((SELECT MAX(supabase_order_no) FROM oms.orders), 0) + 1,
                    false
                );
            """,
            reverse_sql="UPDATE oms.orders SET supabase_order_no = NULL;",
        ),
        # Now that every row holds a distinct value, add the unique
        # constraint and the Python-level default (used by the ORM for
        # *new* rows going forward, at Model.__init__/save time - not by
        # this migration, which never re-touches existing data here).
        migrations.AlterField(
            model_name="order",
            name="supabase_order_no",
            field=models.PositiveIntegerField(
                blank=True,
                default=oms.models._next_supabase_order_no,
                editable=False,
                null=True,
                unique=True,
            ),
        ),
    ]
