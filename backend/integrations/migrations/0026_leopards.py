# Hand-written, same pattern as 0020_postex.py: Leopards Courier gets its own
# Postgres schema in Supabase ("leopards_integrations"), separate from
# Smartlane/Shopify's "integrations", BarqRaftar's "barqraftar_integrations"
# and PostEx's "postex_integrations", with RLS policies on all three tables.
#
# Only NEW tables - nothing already deployed reads or writes them, so this is
# safe to apply before the code that uses it is deployed. The matching plain
# SQL (for running by hand in Supabase's SQL editor) is
# integrations/leopards/sql/0026_leopards.sql; it also records this migration
# in django_migrations so a later `migrate` doesn't try to create it again.
#
# The last operation only widens OmsCourierEnrollment.courier's `choices`
# with "leopards" (a Python-side change, no SQL).

import uuid

import django.db.models.deletion
from django.db import migrations, models

import integrations.leopards.models
from core.rls import organization_scoped_policy_sql

CREATE_SCHEMA = "create schema if not exists leopards_integrations;"
DROP_SCHEMA = ""  # left in place - dropping would cascade any data in it

ENABLE_RLS = (
    organization_scoped_policy_sql("leopards_integrations", "connections")
    + organization_scoped_policy_sql("leopards_integrations", "shipments")
    + organization_scoped_policy_sql("leopards_integrations", "sync_jobs")
)
DISABLE_RLS = """
    drop policy if exists connections_tenant_isolation on "leopards_integrations"."connections";
    alter table "leopards_integrations"."connections" disable row level security;

    drop policy if exists shipments_tenant_isolation on "leopards_integrations"."shipments";
    alter table "leopards_integrations"."shipments" disable row level security;

    drop policy if exists sync_jobs_tenant_isolation on "leopards_integrations"."sync_jobs";
    alter table "leopards_integrations"."sync_jobs" disable row level security;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_jwt_claim_app_metadata_only'),
        ('integrations', '0025_smartlaneshipment'),
        ('oms', '0032_order_customer_note_booked_at'),
    ]

    operations = [
        migrations.RunSQL(sql=CREATE_SCHEMA, reverse_sql=DROP_SCHEMA),
        migrations.CreateModel(
            name='LeopardsSyncJob',
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
                'db_table': '"leopards_integrations"."sync_jobs"',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='LeopardsConnection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('api_key', models.CharField(blank=True, default='', max_length=255)),
                ('api_password', models.CharField(blank=True, default='', max_length=255)),
                ('is_connected', models.BooleanField(default=False)),
                ('shipper_name', models.CharField(blank=True, default='', max_length=255)),
                ('origin_city_id', models.PositiveIntegerField(blank=True, null=True)),
                ('origin_city_name', models.CharField(blank=True, default='', max_length=150)),
                ('default_weight_grams', models.PositiveIntegerField(default=500)),
                ('default_shipment_type', models.CharField(blank=True, default='', max_length=50)),
                ('default_notes', models.CharField(blank=True, default='', max_length=255)),
                ('load_sheet_courier_name', models.CharField(default='FynkTech OMS', max_length=100)),
                ('load_sheet_courier_code', models.CharField(default='1', max_length=30)),
                ('cities_cache', models.JSONField(blank=True, default=list)),
                ('cities_cached_at', models.DateTimeField(blank=True, null=True)),
                ('city_aliases', models.JSONField(blank=True, default=dict)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('webhook_token', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('webhook_secret', models.CharField(default=integrations.leopards.models.new_webhook_secret, editable=False, max_length=64)),
                ('last_event_at', models.DateTimeField(blank=True, null=True)),
                ('events_received_count', models.PositiveIntegerField(default=0)),
                ('recent_webhook_payloads', models.JSONField(blank=True, default=list)),
                ('last_webhook_error', models.CharField(blank=True, default='', max_length=255)),
                ('last_webhook_error_at', models.DateTimeField(blank=True, null=True)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='core.organization')),
            ],
            options={
                'db_table': '"leopards_integrations"."connections"',
                'constraints': [models.UniqueConstraint(fields=('organization',), name='leopards_one_connection_per_org')],
            },
        ),
        migrations.CreateModel(
            name='LeopardsShipment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('reference', models.CharField(max_length=100)),
                ('tracking_number', models.CharField(blank=True, default='', max_length=100)),
                ('slip_link', models.CharField(blank=True, default='', max_length=500)),
                ('shipper_id', models.CharField(blank=True, default='', max_length=30)),
                ('status_label', models.CharField(blank=True, default='', max_length=100)),
                ('status_history', models.JSONField(blank=True, default=list)),
                ('last_payload', models.JSONField(blank=True, default=dict)),
                ('is_active', models.BooleanField(default=True)),
                ('booked_at', models.DateTimeField(auto_now_add=True)),
                ('load_sheet_id', models.CharField(blank=True, default='', max_length=50)),
                ('load_sheet_at', models.DateTimeField(blank=True, null=True)),
                ('cancelled_at', models.DateTimeField(blank=True, null=True)),
                ('last_checked_at', models.DateTimeField(blank=True, null=True)),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='leopards_shipments', to='oms.order')),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='core.organization')),
            ],
            options={
                'db_table': '"leopards_integrations"."shipments"',
                'ordering': ['-created_at'],
                'indexes': [models.Index(fields=['organization', 'is_active', 'last_checked_at'], name='leopards_shipment_poll_idx'), models.Index(fields=['organization', 'tracking_number'], name='leopards_shipment_tn_idx')],
                'constraints': [models.UniqueConstraint(fields=('organization', 'reference'), name='leopards_reference_unique_per_org'), models.UniqueConstraint(condition=models.Q(('is_active', True)), fields=('order',), name='leopards_one_active_shipment_per_order')],
            },
        ),
        migrations.RunSQL(sql=ENABLE_RLS, reverse_sql=DISABLE_RLS),
        migrations.AlterField(
            model_name='omscourierenrollment',
            name='courier',
            field=models.CharField(choices=[('smartlane', 'Smartlane'), ('postex', 'PostEx'), ('barq_raftar', 'BarqRaftar'), ('leopards', 'Leopards')], max_length=20),
        ),
    ]
