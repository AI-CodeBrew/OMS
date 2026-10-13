from django.db import migrations, models


class Migration(migrations.Migration):
    """Order.courier_charges - the courier's delivery charges from its sheet,
    apart from the order total. Nullable, so backend code that predates it
    (on the same database) keeps inserting orders without it."""

    dependencies = [
        ('oms', '0027_order_courier_status_db_default'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='courier_charges',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
    ]
