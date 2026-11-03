from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0042_order_return_breakdown"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="shipper_advice",
            field=models.CharField(blank=True, db_default="", default="", max_length=20),
        ),
        migrations.AddField(
            model_name="order",
            name="shipper_advice_remarks",
            field=models.CharField(blank=True, db_default="", default="", max_length=255),
        ),
        migrations.AddField(
            model_name="order",
            name="shipper_advice_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
