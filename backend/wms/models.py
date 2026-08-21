"""WMS models land here in a later phase - warehouses, stock_items,
stock_movements - each extending core.models.TenantScopedModel and
declared in the "wms" Postgres schema, following the pattern in
oms/models.py. This app is registered and migratable now so adding those
models later is a normal migration, not new wiring."""
