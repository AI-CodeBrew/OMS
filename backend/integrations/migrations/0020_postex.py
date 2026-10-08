# Hand-written, same pattern as 0017_barqraftar.py: PostEx gets its own
# Postgres schema in Supabase ("postex_integrations"), separate from
# Smartlane/Shopify's "integrations" and BarqRaftar's
# "barqraftar_integrations", with RLS policies on all three tables.

import django.db.models.deletion
import uuid
from django.db import migrations, models

from core.rls import organization_scoped_policy_sql

CREATE_SCHEMA = "create schema if not exists postex_integrations;"
DROP_SCHEMA = ""  # left in place - dropping would cascade any data in it

ENABLE_RLS = (
    organization_scoped_policy_sql("postex_integrations", "connections")
    + organization_scoped_policy_sql("postex_integrations", "shipments")
    + organization_scoped_policy_sql("postex_integrations", "sync_jobs")
)
DISABLE_RLS = """
    drop policy if exists connections_tenant_isolation on "postex_integrations"."connections";
    alter table "postex_integrations"."connections" disable row level security;

    drop policy if exists shipments_tenant_isolation on "postex_integrations"."shipments";
    alter table "postex_integrations"."shipments" disable row level security;

    drop policy if exists sync_jobs_tenant_isolation on "postex_integrations"."sync_jobs";
    alter table "postex_integrations"."sync_jobs" disable row level security;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_dispatchhubstore'),
        ('integrations', '0019_barqraftar_account_number'),
        ('oms', '0023_order_supabase_order_no'),
    ]

    operations = [
        migrations.RunSQL(sql=CREATE_SCHEMA, reverse_sql=DROP_SCHEMA),
        migrations.CreateModel(
            name='PostExSyncJob',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('running', 'Running'), ('completed', 'Completed'), ('failed', 'Failed'), ('cancelled', 'Cancelled')], default='pending', max_length=10)),
                ('cancel_requested', models.BooleanField(default=False)),
                ('checked_count', models.PositiveIntegerField(default=0)),
                ('updated_count', models.PositiveIntegerField(default=0)),
                ('total_available', models.PositiveIntegerField(blank=True, null=True)),
                ('error_message', models.CharField(blank=True, default='', max_length=500)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='core.organization')),
            ],
            options={
                'db_table': '"postex_integrations"."sync_jobs"',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='PostExConnection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('api_token', models.CharField(blank=True, default='', max_length=255)),
                ('is_connected', models.BooleanField(default=False)),
                ('merchant_name', models.CharField(blank=True, default='', max_length=255)),
                ('pickup_address_code', models.CharField(blank=True, default='', max_length=20)),
                ('pickup_address_label', models.CharField(blank=True, default='', max_length=255)),
                ('pickup_city_name', models.CharField(blank=True, default='', max_length=150)),
                ('default_order_type', models.CharField(default='Normal', max_length=20)),
                ('default_notes', models.CharField(blank=True, default='', max_length=255)),
                ('cities_cache', models.JSONField(blank=True, default=list)),
                ('cities_cached_at', models.DateTimeField(blank=True, null=True)),
                ('city_aliases', models.JSONField(blank=True, default=dict)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='core.organization')),
            ],
            options={
                'db_table': '"postex_integrations"."connections"',
                'constraints': [models.UniqueConstraint(fields=('organization',), name='postex_one_connection_per_org')],
            },
        ),
        migrations.CreateModel(
            name='PostExShipment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('reference', models.CharField(max_length=100)),
                ('tracking_number', models.CharField(blank=True, default='', max_length=100)),
                ('status_label', models.CharField(blank=True, default='', max_length=100)),
                ('status_history', models.JSONField(blank=True, default=list)),
                ('last_payload', models.JSONField(blank=True, default=dict)),
                ('pickup_address_code', models.CharField(blank=True, default='', max_length=20)),
                ('is_active', models.BooleanField(default=True)),
                ('booked_at', models.DateTimeField(auto_now_add=True)),
                ('load_sheet_at', models.DateTimeField(blank=True, null=True)),
                ('cancelled_at', models.DateTimeField(blank=True, null=True)),
                ('last_checked_at', models.DateTimeField(blank=True, null=True)),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='postex_shipments', to='oms.order')),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='core.organization')),
            ],
            options={
                'db_table': '"postex_integrations"."shipments"',
                'ordering': ['-created_at'],
                'indexes': [models.Index(fields=['organization', 'is_active', 'last_checked_at'], name='postex_shipment_poll_idx'), models.Index(fields=['organization', 'tracking_number'], name='postex_shipment_tn_idx')],
                'constraints': [models.UniqueConstraint(fields=('organization', 'reference'), name='postex_reference_unique_per_org'), models.UniqueConstraint(condition=models.Q(('is_active', True)), fields=('order',), name='postex_one_active_shipment_per_order')],
            },
        ),
        migrations.RunSQL(sql=ENABLE_RLS, reverse_sql=DISABLE_RLS),
    ]
