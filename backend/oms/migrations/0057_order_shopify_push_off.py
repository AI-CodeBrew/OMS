# Generated for the speed/cleanup work on 2026-11-20

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('oms', '0056_pack_units'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='shopify_push_off',
            field=models.BooleanField(db_default=False, default=False),
        ),
    ]
