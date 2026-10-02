import uuid

import django.db.models.deletion
from django.db import migrations, models

from core.rls import organization_scoped_policy_sql

ENABLE_RLS = organization_scoped_policy_sql("finance", "invoices") + organization_scoped_policy_sql(
    "finance", "invoice_lines"
)
DISABLE_RLS = """
    drop policy if exists invoices_tenant_isolation on "finance"."invoices";
    alter table "finance"."invoices" disable row level security;

    drop policy if exists invoice_lines_tenant_isolation on "finance"."invoice_lines";
    alter table "finance"."invoice_lines" disable row level security;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_dispatchhubstore"),
        ("finance", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Invoice",
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
                ("number", models.CharField(blank=True, default="", max_length=30)),
                ("period_start", models.DateField(blank=True, null=True)),
                ("period_end", models.DateField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("issued", "Issued"),
                            ("paid", "Paid"),
                            ("void", "Void"),
                        ],
                        default="draft",
                        max_length=10,
                    ),
                ),
                ("issued_at", models.DateTimeField(blank=True, null=True)),
                ("due_date", models.DateField(blank=True, null=True)),
                ("subtotal", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("total", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_by", models.UUIDField(blank=True, null=True)),
            ],
            options={
                "db_table": '"finance"."invoices"',
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="invoice",
            constraint=models.UniqueConstraint(
                condition=models.Q(("number", ""), _negated=True),
                fields=("number",),
                name="finance_invoice_number_unique_when_set",
            ),
        ),
        migrations.CreateModel(
            name="InvoiceLine",
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
                (
                    "kind",
                    models.CharField(
                        choices=[("dispatch_fee", "Dispatch Fee"), ("manual", "Manual")],
                        default="manual",
                        max_length=20,
                    ),
                ),
                ("description", models.CharField(max_length=255)),
                ("quantity", models.DecimalField(decimal_places=2, default=1, max_digits=10)),
                ("unit_price", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                (
                    "invoice",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lines",
                        to="finance.invoice",
                    ),
                ),
            ],
            options={
                "db_table": '"finance"."invoice_lines"',
                "ordering": ["created_at"],
            },
        ),
        migrations.RunSQL(sql=ENABLE_RLS, reverse_sql=DISABLE_RLS),
    ]
