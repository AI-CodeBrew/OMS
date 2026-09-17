from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0020_order_smartlane_checked_at"),
    ]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("pending_cc", "Pending CC"),
                    ("pending_cod", "Pending COD"),
                    ("city_issue", "City Issue"),
                    ("awaiting_assigning", "Awaiting Assigning"),
                    ("awaiting_approval", "Awaiting Approval"),
                    ("approved", "Approved"),
                    ("booking_pending", "Booking Pending"),
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
        migrations.AddField(
            model_name="order",
            name="return_in_progress_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
