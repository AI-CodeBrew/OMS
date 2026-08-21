def organization_scoped_policy_sql(schema, table):
    """RLS template for any table carrying an organization_id column.
    Reused by every app's migrations (oms now; wms/finance later) so the
    policy shape stays identical across modules.

    IMPORTANT: this is defense-in-depth for direct Postgres/PostgREST
    access (anon/authenticated Supabase roles) - it is NOT what protects
    tenant isolation from Django itself. Django connects through
    Supabase's pooler using a role with BYPASSRLS (required for the
    pooler to work), so these policies are invisible to Django's own
    queries. The real enforcement for Django is TenantScopedModel's
    manager + TenantMiddleware (core/models.py, core/middleware.py). Keep
    both: RLS here covers any client that talks to Postgres directly,
    app-level scoping covers Django.
    """
    qualified = f'"{schema}"."{table}"'
    policy = f"{table}_tenant_isolation"
    return f"""
        alter table {qualified} enable row level security;
        alter table {qualified} force row level security;

        drop policy if exists {policy} on {qualified};
        create policy {policy} on {qualified}
          for all
          using (
            core.is_super_admin()
            or organization_id = core.current_organization_id()
          )
          with check (
            core.is_super_admin()
            or organization_id = core.current_organization_id()
          );
    """
