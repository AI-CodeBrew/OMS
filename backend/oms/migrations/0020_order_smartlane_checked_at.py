from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0019_printbatch_ordering_updated_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="smartlane_checked_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="order",
            index=models.Index(
                fields=["organization", "smartlane_checked_at"],
                name="oms_order_org_sl_checked_idx",
            ),
        ),
    ]
