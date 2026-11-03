"""Fill integrations.SmartlaneShipment for orders already booked through
Smartlane - delivered, returned and cancelled ones included, which the
regular poll (poll_smartlane) no longer asks about.

    python manage.py backfill_smartlane_shipments
    python manage.py backfill_smartlane_shipments --organization <uuid> --all

Records what Smartlane reports (and the order fields record_smartlane_shipment
copies: return reason, paid, tag) but never moves an order's status - that
stays the poll's and the webhook's job.
"""

from django.core.management.base import BaseCommand

from core.context import tenant_context
from core.platform_service import is_platform_organization
from integrations import smartlane_client
from integrations.models import SmartlaneConnection
from integrations.services import record_smartlane_shipment, smartlane_warehouse_names
from oms.models import Order

# Smartlane's /track cap (see services.poll_smartlane_statuses).
BATCH_SIZE = 50


class Command(BaseCommand):
    help = "Record Smartlane's tracking details for orders already booked through Smartlane."

    def add_arguments(self, parser):
        parser.add_argument(
            "--organization",
            dest="organization_id",
            help="Only this organization (defaults to every connected Smartlane account).",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help="Refresh orders that already have Smartlane details too (default: only missing ones).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=5000,
            help="Maximum orders per account (default 5000).",
        )

    def handle(self, *args, **options):
        connections = SmartlaneConnection.all_objects.filter(is_connected=True).exclude(api_key="")
        if options.get("organization_id"):
            connections = connections.filter(organization_id=options["organization_id"])
        if not connections.exists():
            self.stdout.write(self.style.WARNING("No connected Smartlane accounts."))
            return

        for connection in connections:
            self._backfill(connection, refresh=options["all"], limit=options["limit"])

    def _backfill(self, connection, *, refresh, limit):
        label = f"{connection.organization_id} ({connection.courier_name})"
        platform = is_platform_organization(connection.organization_id)
        # FynkTech's own account knows Dispatch Hub bookings, across stores,
        # by platform_reference; a store's account its own orders by number.
        orders = Order.all_objects.filter(courier__name=connection.courier_name).exclude(tracking_number="")
        if platform:
            orders = orders.exclude(platform_reference="")
        else:
            orders = orders.filter(organization_id=connection.organization_id, platform_reference="")
        if not refresh:
            orders = orders.filter(smartlane_shipment__isnull=True)
        orders = list(orders.order_by("-created_at")[:limit])
        if not orders:
            self.stdout.write(f"{label}: nothing to backfill")
            return

        self.stdout.write(f"{label}: asking Smartlane about {len(orders)} order(s)")
        warehouse_names = smartlane_warehouse_names(connection.api_key)
        recorded = 0
        for start in range(0, len(orders), BATCH_SIZE):
            chunk = orders[start:start + BATCH_SIZE]
            by_reference = {}
            for order in chunk:
                reference = SmartlaneConnection.reference_for(order)
                stripped = reference.lstrip("#")
                for key in dict.fromkeys([reference, f"#{stripped}", stripped]):
                    by_reference.setdefault(key, order)
            try:
                rows = smartlane_client.track_consignments(
                    connection.api_key, [SmartlaneConnection.reference_for(o) for o in chunk]
                )
            except smartlane_client.SmartlaneAPIError as exc:
                self.stderr.write(self.style.ERROR(f"{label}: batch failed - {exc}"))
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                order = by_reference.get(str(row.get("store_order_id") or "").strip())
                if order is None:
                    continue
                with tenant_context(order.organization_id):
                    record_smartlane_shipment(
                        order, row, account=connection.courier_name, warehouse_names=warehouse_names
                    )
                recorded += 1
            self.stdout.write(f"  {min(start + BATCH_SIZE, len(orders))}/{len(orders)} asked, {recorded} recorded")

        self.stdout.write(self.style.SUCCESS(f"{label}: recorded {recorded} of {len(orders)}"))
