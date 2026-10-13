from django.db import migrations, models


class Migration(migrations.Migration):
    """Gives orders.courier_status a database default ('').

    0026 added it NOT NULL with Django's usual Python-side default only, so
    the column has no default of its own. Backend code that predates the
    field - still running against the same database - leaves it out of
    every order INSERT, and Postgres refused those rows: new Shopify orders
    stopped arriving. With a database default they go in as ''.
    """

    dependencies = [
        ('oms', '0026_order_courier_status'),
    ]

    operations = [
        migrations.AlterField(
            model_name='order',
            name='courier_status',
            field=models.CharField(blank=True, db_default='', default='', max_length=100),
        ),
    ]
