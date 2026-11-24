# Fix Cities (user, 2026-11-23): the order's city-fix badge (city_fix,
# city_before_fix for Undo, city_fix_note) and the learned spellings table.
# Existing orders get "" - no badge.

from django.db import migrations, models

from core.rls import platform_admin_only_policy_sql

# A platform-wide table (no organization_id) - super admin only for any
# direct Postgres/PostgREST client; Django bypasses RLS as usual.
RLS = platform_admin_only_policy_sql("oms", "city_spellings")
NO_RLS = 'alter table "oms"."city_spellings" disable row level security;'


class Migration(migrations.Migration):

    dependencies = [
        ('oms', '0058_dispatch_batch_source'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='city_fix',
            field=models.CharField(blank=True, db_default='', default='', max_length=10),
        ),
        migrations.AddField(
            model_name='order',
            name='city_before_fix',
            field=models.CharField(blank=True, db_default='', default='', max_length=100),
        ),
        migrations.AddField(
            model_name='order',
            name='city_fix_note',
            field=models.CharField(blank=True, db_default='', default='', max_length=255),
        ),
        migrations.CreateModel(
            name='CitySpelling',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('typed_key', models.CharField(max_length=100)),
                ('city_name', models.CharField(max_length=100)),
                ('times', models.PositiveIntegerField(default=1)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('last_used_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': '"oms"."city_spellings"',
                'ordering': ['typed_key'],
                'constraints': [
                    models.UniqueConstraint(fields=('typed_key', 'city_name'), name='city_spelling_unique'),
                ],
            },
        ),
        migrations.RunSQL(sql=RLS, reverse_sql=NO_RLS),
    ]
