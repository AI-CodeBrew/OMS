from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("integrations", "0014_smartlanesyncjob"),
    ]

    operations = [
        migrations.AddField(
            model_name="shopifyconnection",
            name="push_status_to_shopify",
            field=models.BooleanField(default=False),
        ),
    ]
