"""Pull delivery outcomes from Smartlane for every connected organization.

Intended to run on a schedule (Windows Task Scheduler / cron), e.g. every
15 minutes:

    python manage.py poll_smartlane

This is the automatic route to delivered/returned statuses. The status
webhook would do the same job instantly, but it needs a publicly
reachable HTTPS URL, whereas polling works from a local machine - so this
is what makes the pipeline self-updating before any deployment exists.
"""

from django.core.management.base import BaseCommand

from integrations.models import SmartlaneConnection
from integrations.services import poll_smartlane_statuses
from integrations.smartlane_client import SmartlaneAPIError


class Command(BaseCommand):
    help = "Poll Smartlane for shipment statuses and advance matching orders."

    def add_arguments(self, parser):
        parser.add_argument(
            "--organization",
            dest="organization_id",
            help="Only poll this organization (defaults to every connected one).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=1000,
            help="Maximum orders to check per organization (default 1000).",
        )

    def handle(self, *args, **options):
        connections = SmartlaneConnection.all_objects.filter(is_connected=True)
        if options.get("organization_id"):
            connections = connections.filter(organization_id=options["organization_id"])

        if not connections.exists():
            self.stdout.write(self.style.WARNING("No connected Smartlane accounts."))
            return

        for connection in connections:
            org_id = connection.organization_id
            try:
                result = poll_smartlane_statuses(org_id, limit=options["limit"])
            except SmartlaneAPIError as exc:
                # One org's credentials being wrong must not stop the rest.
                self.stderr.write(self.style.ERROR(f"{org_id}: {exc}"))
                continue

            self.stdout.write(
                self.style.SUCCESS(
                    f"{org_id}: checked {result['checked']}, updated {result['updated']}"
                    + (f" - {result['detail']}" if result.get("detail") else "")
                )
            )
