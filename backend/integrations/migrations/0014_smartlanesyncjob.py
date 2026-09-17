import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
        ('integrations', '0013_smartlanestorelink_kyc_poc_cnic_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='SmartlaneSyncJob',
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
                'db_table': '"integrations"."smartlane_sync_jobs"',
                'ordering': ['-created_at'],
            },
        ),
    ]
