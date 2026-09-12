# Generated manually (matching Django 5.2.17's normal makemigrations output) -
# local makemigrations couldn't run: the venv is missing psycopg_pool, which
# the DB-consistency check makemigrations performs needs to connect. Written
# by hand instead, following the exact shape of 0012's AddField operations.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0012_smartlanestorelink_kyc_city_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='smartlanestorelink',
            name='kyc_state',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='smartlanestorelink',
            name='kyc_poc_cnic',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
    ]
