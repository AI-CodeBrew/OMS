import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_organization_is_manual_store"),
    ]

    operations = [
        migrations.CreateModel(
            name="DispatchHubStore",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                (
                    "per_order_rate",
                    models.DecimalField(decimal_places=2, default=0, max_digits=12),
                ),
                ("added_by", models.UUIDField(blank=True, null=True)),
                ("added_at", models.DateTimeField(auto_now_add=True)),
                (
                    "organization",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="dispatch_hub_entry",
                        to="core.organization",
                    ),
                ),
            ],
            options={
                "db_table": '"core"."dispatch_hub_stores"',
                "ordering": ["organization__name"],
            },
        ),
    ]
