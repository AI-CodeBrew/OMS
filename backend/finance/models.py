"""Finance models - the "finance" Postgres schema, following the pattern
in oms/models.py. Invoices/payments proper land here in a later phase and
will subscribe to the order.confirmed event (see core/events.py); for now
this holds just the one thing both the tenant and super-admin sides need
first: where to remit a store's COD collections."""

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
