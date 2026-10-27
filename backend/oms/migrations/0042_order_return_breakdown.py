from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0041_order_workflow_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="return_breakdown",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
