from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0021_order_out_for_delivery_attempt_return_in_progress"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="shopify_fulfillment_id",
            field=models.BigIntegerField(blank=True, null=True),
        ),
    ]
