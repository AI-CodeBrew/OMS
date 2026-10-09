from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0023_order_supabase_order_no"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="dispatch_requested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
