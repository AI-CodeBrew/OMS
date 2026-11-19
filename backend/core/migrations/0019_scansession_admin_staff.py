from django.db import migrations, models


class Migration(migrations.Migration):
    """Joins the two lines of core migrations (main's 0011_organization_module_ims
    .. 0018 and the phone scanner's 0011_scansession), and keeps a super admin
    login's admin_staff flag on its phone scan sessions (core.middleware's
    admin staff gate). A new column with a database default - safe for code
    that doesn't know it yet."""

    dependencies = [
        ("core", "0011_scansession"),
        ("core", "0018_organization_shopify_resync"),
    ]

    operations = [
        migrations.AddField(
            model_name="scansession",
            name="admin_staff",
            field=models.BooleanField(db_default=False, default=False),
        ),
    ]
