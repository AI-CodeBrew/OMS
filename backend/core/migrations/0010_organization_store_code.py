from django.db import migrations, models

# Organization.store_code: every store's own number (1, 2, 3 ... oldest
# first), so stores sharing a name can be told apart - e.g. the Dispatch
# Hub's Manual Order store picker. New stores take the next number from the
# sequence (Organization.save).

FORWARD = """
create sequence if not exists core.organization_store_code_seq;

update core.organizations o
set store_code = numbered.n
from (
  select id, row_number() over (order by created_at, id) as n
  from core.organizations
) numbered
where o.id = numbered.id;

select setval(
  'core.organization_store_code_seq',
  coalesce((select max(store_code) from core.organizations), 0) + 1,
  false
);
"""

BACKWARD = "drop sequence if exists core.organization_store_code_seq;"


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0009_jwt_claim_app_metadata_only"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="store_code",
            field=models.PositiveIntegerField(blank=True, editable=False, null=True, unique=True),
        ),
        migrations.RunSQL(FORWARD, BACKWARD),
    ]
