# Batches made at booking (user, 2026-11-23) - DispatchBatch.source tells a
# booking batch from a print-only one. Existing batches are all "print".

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('oms', '0057_order_shopify_push_off'),
    ]

    operations = [
        migrations.AddField(
            model_name='dispatchbatch',
            name='source',
            field=models.CharField(
                choices=[('booking', 'Booking'), ('print', 'Print')],
                db_default='print', default='print', max_length=10,
            ),
        ),
    ]
