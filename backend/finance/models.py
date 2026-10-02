"""Finance models - the "finance" Postgres schema, following the pattern
in oms/models.py."""

import uuid

from django.db import models

from core.models import TenantScopedModel


class BankDetails(TenantScopedModel):
    """One per org - where FynkTech remits this store's COD collections.
    Asked for once (see frontend's bank-details gate, shown before
    connecting an integration or creating a store) and never again once
    saved."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account_title = models.CharField(max_length=255)
    bank_name = models.CharField(max_length=255)
    account_number = models.CharField(max_length=50, blank=True, default="")
    iban = models.CharField(max_length=34, blank=True, default="")
    branch_code = models.CharField(max_length=50, blank=True, default="")
    # Supabase auth.users.id - same non-FK convention as core.Membership.user_id.
    updated_by = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"finance"."bank_details"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization"], name="finance_one_bank_details_per_org"
            )
        ]

    def __str__(self):
        return f"Bank details ({self.organization_id})"


class Invoice(TenantScopedModel):
    """What FynkTech bills a store for dispatching its orders over a
    period. Created as a draft from the super admin's Dispatch Hub ->
    Invoices screen (pre-filled from DispatchHubStore.per_order_rate x the
    store's dispatched-order count for the period, then hand-editable) and
    only visible to the store itself once issued - see finance/views.py's
    tenant list, which excludes drafts."""

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("issued", "Issued"),
        ("paid", "Paid"),
        ("void", "Void"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Assigned only on issue (see finance.invoice_service.issue_invoice) -
    # blank for a draft, which has nothing to show a store yet anyway.
    number = models.CharField(max_length=30, blank=True, default="")
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="draft")
    issued_at = models.DateTimeField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    # Same convention as oms.Order - stored, not computed, so a later rate
    # change or line edit never silently reflows an already-issued invoice.
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    notes = models.TextField(blank=True, default="")
    # Supabase auth.users.id - same non-FK convention as core.Membership.user_id.
    created_by = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"finance"."invoices"'
        ordering = ["-created_at"]
        constraints = [
            # FynkTech's own global sequence (FT-INV-2026-0001, ...), not
            # per-org - unique only once assigned, so any number of drafts
            # (number="") can coexist.
            models.UniqueConstraint(
                fields=["number"],
                condition=~models.Q(number=""),
                name="finance_invoice_number_unique_when_set",
            )
        ]

    def __str__(self):
        return self.number or f"Draft invoice ({self.id})"


class InvoiceLine(TenantScopedModel):
    KIND_CHOICES = [
        ("dispatch_fee", "Dispatch Fee"),
        ("manual", "Manual"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="manual")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = '"finance"."invoice_lines"'
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.description} ({self.invoice_id})"
