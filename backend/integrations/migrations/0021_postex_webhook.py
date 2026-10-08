# Hand-written: adds PostEx's status-webhook fields. The token/secret are
# added without a default first and filled per row, then given their real
# definitions - a unique field added with a callable default in one step
# would hand every existing row the SAME value (and the same secret).

import uuid
import secrets

from django.db import migrations, models

import integrations.postex.models


def fill_webhook_credentials(apps, schema_editor):
    PostExConnection = apps.get_model("integrations", "PostExConnection")
    for connection in PostExConnection.objects.all():
        connection.webhook_token = uuid.uuid4()
        connection.webhook_secret = secrets.token_urlsafe(32)
        connection.save(update_fields=["webhook_token", "webhook_secret"])


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0020_postex'),
    ]

    operations = [
        migrations.AddField(
            model_name='postexconnection',
            name='webhook_token',
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name='postexconnection',
            name='webhook_secret',
            field=models.CharField(default='', editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name='postexconnection',
            name='last_event_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='postexconnection',
            name='events_received_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='postexconnection',
            name='recent_webhook_payloads',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='postexconnection',
            name='last_webhook_error',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='postexconnection',
            name='last_webhook_error_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(fill_webhook_credentials, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='postexconnection',
            name='webhook_token',
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name='postexconnection',
            name='webhook_secret',
            field=models.CharField(
                default=integrations.postex.models.new_webhook_secret, editable=False, max_length=64
            ),
        ),
    ]
