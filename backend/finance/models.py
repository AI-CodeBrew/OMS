"""Finance models land here in a later phase - invoices, payments - each
extending core.models.TenantScopedModel and declared in the "finance"
Postgres schema, following the pattern in oms/models.py. Will subscribe
to the order.confirmed event (see core/events.py) once it exists."""
