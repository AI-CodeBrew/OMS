from django.db import migrations

# core.jwt_claim fell back to user_metadata, which any signed-in user can
# write themselves (supabase.auth.updateUser) - e.g. a login whose
# app_metadata organization_id was cleared could point the tenant-isolation
# RLS policies at any store. Access claims now come from app_metadata only,
# which only the backend's service key can set.

APP_METADATA_ONLY = """
create or replace function core.jwt_claim(claim text)
returns text
language sql stable
as $$
  select auth.jwt() -> 'app_metadata' ->> claim;
$$;
"""

WITH_USER_METADATA_FALLBACK = """
create or replace function core.jwt_claim(claim text)
returns text
language sql stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> claim,
    auth.jwt() -> 'user_metadata' ->> claim
  );
$$;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_audit_log_activity"),
    ]

    operations = [
        migrations.RunSQL(APP_METADATA_ONLY, reverse_sql=WITH_USER_METADATA_FALLBACK),
    ]
