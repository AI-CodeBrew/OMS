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


def platform_admin_only_policy_sql(schema, table):
    """RLS template for a platform-level table with no organization_id at
    all (e.g. a singleton config row, or a shared catalog every org reads
    but only a super admin edits).

    Same defense-in-depth caveat as organization_scoped_policy_sql above:
    Django bypasses this entirely via its BYPASSRLS pooler role, so tenant
    users still see whatever the app's own views choose to serve them
    (e.g. a courier catalog) regardless of this policy. What this actually
    blocks is a *direct* Postgres/PostgREST client with a regular
    authenticated-but-not-super-admin JWT reading or writing the table on
    its own - which for something like stored API credentials should
    never be possible.
    """
    qualified = f'"{schema}"."{table}"'
    policy = f"{table}_super_admin_only"
    return f"""
        alter table {qualified} enable row level security;
        alter table {qualified} force row level security;

        drop policy if exists {policy} on {qualified};
        create policy {policy} on {qualified}
          for all
          using (core.is_super_admin())
          with check (core.is_super_admin());
    """
