from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("oms", "0018_ticket_number_priority_assignment_fix"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="printbatch",
            options={"ordering": ["-updated_at"]},
        ),
    ]
