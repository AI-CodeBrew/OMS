from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_membership_allowed_modules_audits"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="is_manual_store",
            field=models.BooleanField(default=False),
        ),
    ]
