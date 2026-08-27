# Generated manually for org RBAC + audit logs

import django.db.models.deletion
import uuid
from django.db import migrations, models

from core.rls import organization_scoped_policy_sql


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="membership",
            name="allowed_modules",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.CreateModel(
            name="OrganizationAuditLog",
            fields=[
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="+",
                        to="core.organization",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("actor_user_id", models.UUIDField(blank=True, null=True)),
                ("actor_email", models.CharField(blank=True, default="", max_length=255)),
                ("action", models.CharField(max_length=64)),
                ("entity_type", models.CharField(blank=True, default="", max_length=64)),
                ("entity_id", models.CharField(blank=True, default="", max_length=64)),
                ("summary", models.CharField(max_length=500)),
                ("metadata", models.JSONField(blank=True, default=dict)),
            ],
            options={
                "db_table": '"core"."organization_audit_logs"',
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="organizationauditlog",
            index=models.Index(
                fields=["organization", "-created_at"],
                name="core_audit_org_created",
            ),
        ),
        migrations.RunSQL(
            sql=organization_scoped_policy_sql("core", "organization_audit_logs"),
            reverse_sql="""
                drop policy if exists organization_audit_logs_tenant_isolation
                  on "core"."organization_audit_logs";
                alter table "core"."organization_audit_logs" disable row level security;
            """,
        ),
    ]
