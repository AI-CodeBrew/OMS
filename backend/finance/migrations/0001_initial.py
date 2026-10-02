# Hand-edited: creates the "finance" Postgres schema (own schema, same
# convention as every other app - see core/migrations/0001_initial.py and
# integrations/migrations/0017_barqraftar.py) plus RLS for bank_details.

import uuid

import django.db.models.deletion
from django.db import migrations, models

from core.rls import organization_scoped_policy_sql

CREATE_SCHEMA = "create schema if not exists finance;"
DROP_SCHEMA = ""  # left in place - dropping would cascade any data in it

ENABLE_RLS = organization_scoped_policy_sql("finance", "bank_details")
DISABLE_RLS = """
    drop policy if exists bank_details_tenant_isolation on "finance"."bank_details";
    alter table "finance"."bank_details" disable row level security;
"""


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("core", "0003_organization_is_manual_store"),
    ]

    operations = [
        migrations.RunSQL(sql=CREATE_SCHEMA, reverse_sql=DROP_SCHEMA),
        migrations.CreateModel(
            name="BankDetails",
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
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("account_title", models.CharField(max_length=255)),
                ("bank_name", models.CharField(max_length=255)),
                ("account_number", models.CharField(blank=True, default="", max_length=50)),
                ("iban", models.CharField(blank=True, default="", max_length=34)),
                ("branch_code", models.CharField(blank=True, default="", max_length=50)),
                ("updated_by", models.UUIDField(blank=True, null=True)),
            ],
            options={
                "db_table": '"finance"."bank_details"',
            },
        ),
        migrations.AddConstraint(
            model_name="bankdetails",
            constraint=models.UniqueConstraint(
                fields=("organization",), name="finance_one_bank_details_per_org"
            ),
        ),
        migrations.RunSQL(sql=ENABLE_RLS, reverse_sql=DISABLE_RLS),
    ]
