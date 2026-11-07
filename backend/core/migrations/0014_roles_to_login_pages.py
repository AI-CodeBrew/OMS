from django.db import migrations


def roles_to_login_pages(apps, schema_editor):
    """Roles are gone from the app - each login's access is picked on the
    Team form instead. Every login that had a role keeps exactly its pages
    (copied onto the login), then the roles are deleted."""
    Membership = apps.get_model("core", "Membership")
    Role = apps.get_model("core", "Role")

    for membership in Membership.objects.filter(role_ref__isnull=False).select_related("role_ref"):
        if membership.page_permissions is None:
            membership.page_permissions = dict(membership.role_ref.permissions or {})
        membership.role_ref = None
        membership.save(update_fields=["page_permissions", "role_ref"])
    Role.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0013_membership_page_permissions'),
    ]

    operations = [
        migrations.RunPython(roles_to_login_pages, migrations.RunPython.noop),
    ]
