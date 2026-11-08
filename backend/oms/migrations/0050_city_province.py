"""City.province - the orders report's Province column. Existing cities are
pre-filled from the built-in city list (oms.pakistan_provinces); any it
can't place stay blank for the super admin to set on the Cities page."""

from django.db import migrations, models


def prefill(apps, schema_editor):
    from oms.pakistan_provinces import UNKNOWN, province_for_city

    City = apps.get_model("oms", "City")
    changed = []
    for city in City.objects.all():
        province = province_for_city(city.name)
        if province != UNKNOWN:
            city.province = province
            changed.append(city)
    City.objects.bulk_update(changed, ["province"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("oms", "0049_pending_prepaid_label"),
    ]

    operations = [
        migrations.AddField(
            model_name="city",
            name="province",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
        migrations.RunPython(prefill, migrations.RunPython.noop),
    ]
