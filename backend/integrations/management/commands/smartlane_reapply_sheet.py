"""One-time: put every Smartlane order already dispatched on FynkTech's
Smartlane status sheet (integrations/smartlane_status_map.py) - right after
the sheet goes live.

    python manage.py smartlane_reapply_sheet            # dry run: shows what would change
    python manage.py smartlane_reapply_sheet --apply    # saves it

Words only (Sub Status and Tag), from what OMS already has - no Smartlane
call: the order's card, the dispute stamp and the carrier's return reason
Smartlane last reported (SmartlaneShipment), else the order's own return
reason. Orders still moving are also refreshed by the next poll anyway.
"""

from django.core.management.base import BaseCommand

from core.context import tenant_context
from integrations import smartlane_status_map as sm
from integrations.models import SmartlaneConnection, SmartlaneShipment
from oms import services as oms
from oms.models import Order

STATUSES = ("dispatched", "out_for_delivery", "attempt", "delivered", "returned")


def _words(order):
    return f"{oms.card_label(order)} / {order.courier_status or '-'} / {oms.latest_tag(order) or '-'}"


class Command(BaseCommand):
    help = "Apply FynkTech's Smartlane status sheet to existing Smartlane orders (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Save the changes (default: only show them).")

    def handle(self, *args, apply=False, **options):
        mode = "APPLY" if apply else "DRY RUN"
        self.stdout.write(f"== {mode} ==")
        names = list(SmartlaneConnection.COURIER_NAMES.values())
        orders = list(Order.all_objects.filter(courier__name__in=names, status__in=STATUSES))
        shipments = {
            s.order_id: s for s in SmartlaneShipment.all_objects.filter(order_id__in=[o.id for o in orders])
        }
        self.stdout.write(f"{len(orders)} Smartlane order(s) dispatched or later")
        changed = 0
        for order in orders:
            shipment = shipments.get(order.id)
            reason = (shipment.return_reason if shipment else "") or (
                order.return_reason if order.status == "returned" else ""
            )
            if reason == "Reported returned by Smartlane":
                reason = ""
            words = sm.sheet_words(
                oms.workflow_card(order), status=order.status,
                disputed=bool(shipment and shipment.disputed_at and order.status == "attempt"), reason=reason,
            )
            if words is None or (order.courier_status, order.courier_tag) == words:
                continue
            self.stdout.write(f"{order.order_number:<18} {_words(order):<75} => {' / '.join(words)}")
            if apply:
                with tenant_context(order.organization_id):
                    if oms.record_courier_words(order, sub_status=words[0], tag=words[1]):
                        changed += 1
        self.stdout.write(f"== {mode} done: {changed} order(s) changed ==" if apply
                          else "== DRY RUN done - nothing saved. Run with --apply to save. ==")
