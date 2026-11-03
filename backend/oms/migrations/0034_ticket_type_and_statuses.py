from django.db import migrations, models

# "Seen" (a super admin had opened it) is gone from the ticket statuses -
# those tickets carry on as Pending, the closest of the new ones.
SEEN_TO_PENDING = "UPDATE oms.tickets SET status = 'pending' WHERE status = 'seen';"


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0033_order_payment_status_partially_paid"),
    ]

    operations = [
        # db_default too, so code still running from before this change
        # (which doesn't know the column) can keep creating tickets.
        migrations.AddField(
            model_name="ticket",
            name="ticket_type",
            field=models.CharField(
                choices=[("customer", "By Customer"), ("admin", "By Admin")],
                db_default="customer",
                default="customer",
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name="ticket",
            name="status",
            field=models.CharField(
                choices=[
                    ("open", "Open"),
                    ("pending", "Pending"),
                    ("in_progress", "In Progress"),
                    ("awaiting_action", "Awaiting Action"),
                    ("resolved", "Resolved"),
                ],
                default="open",
                max_length=20,
            ),
        ),
        migrations.RunSQL(SEEN_TO_PENDING, reverse_sql=migrations.RunSQL.noop),
    ]
