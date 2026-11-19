import uuid

from django.db import migrations, models

from core.rls import platform_admin_only_policy_sql

# Platform plumbing holding who started each phone session (user id, email,
# role) - no direct Postgres/PostgREST client but a super admin may read it.
# Django bypasses RLS (see core/rls.py), so the app itself is unaffected.
ENABLE_RLS = platform_admin_only_policy_sql("core", "scan_sessions")
DISABLE_RLS = """
    drop policy if exists scan_sessions_super_admin_only on "core"."scan_sessions";
    alter table "core"."scan_sessions" disable row level security;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_organization_store_code"),
    ]

    operations = [
        migrations.CreateModel(
            name="ScanSession",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("user_id", models.UUIDField()),
                ("email", models.CharField(blank=True, default="", max_length=255)),
                ("role", models.CharField(blank=True, default="", max_length=32)),
                ("organization_id", models.UUIDField(blank=True, null=True)),
                ("modules", models.JSONField(blank=True, null=True)),
                ("act_as_organization_id", models.CharField(blank=True, default="", max_length=64)),
                ("hub", models.CharField(blank=True, default="", max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "db_table": '"core"."scan_sessions"',
            },
        ),
        migrations.RunSQL(sql=ENABLE_RLS, reverse_sql=DISABLE_RLS),
    ]
