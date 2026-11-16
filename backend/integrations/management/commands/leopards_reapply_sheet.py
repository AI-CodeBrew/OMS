"""One-time: put every Leopards order already with Leopards on FynkTech's
status sheet (integrations/leopards/status_map.py) - right after the sheet
goes live, so orders don't wait for their next Leopards update.

    python manage.py leopards_reapply_sheet            # dry run: shows what would change
    python manage.py leopards_reapply_sheet --apply    # saves it

- Still moving (Dispatched, Out for Delivery, Undelivered): each parcel is
  read again from Leopards and applied exactly as the poller would (its
  newest tracking line wins) - so a refused parcel moves to Undelivered /
  Waiting for Shipper Advice. Then Leopards' shipper-advice list is read.
- Already Delivered / Returned: only the Sub Status and Tag are set
  (Returned: Awaiting Scan, or Return Received once the Returns Desk has it).
- Not picked up yet: untouched.
"""

from django.core.management.base import BaseCommand

from core.context import tenant_context
from integrations.leopards import services as ls
from integrations.leopards import status_map as sm
from integrations.leopards.models import LeopardsConnection, LeopardsShipment
from oms import services as oms
from oms.models import Order

MOVING = ("dispatched", "out_for_delivery", "attempt")


def _words(order):
    return f"{oms.card_label(order)} / {order.courier_status or '-'} / {oms.latest_tag(order) or '-'}"


class Command(BaseCommand):
    help = "Apply FynkTech's Leopards status sheet to existing Leopards orders (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Save the changes (default: only show them).")

    def handle(self, *args, apply=False, **options):
        mode = "APPLY" if apply else "DRY RUN"
        self.stdout.write(f"== {mode} ==")
        shipments = list(
            LeopardsShipment.all_objects.filter(is_active=True).exclude(tracking_number="").select_related("order")
        )
        moving = [s for s in shipments if s.order.status in MOVING]
        final = [s for s in shipments if s.order.status in ("delivered", "returned")]
        self.stdout.write(f"{len(moving)} moving, {len(final)} delivered/returned, "
                          f"{len(shipments) - len(moving) - len(final)} not picked up (left alone)")

        # 1. Moving parcels: read from Leopards again, per account.
        changed = 0
        for connection in LeopardsConnection.all_objects.filter(is_connected=True):
            mine = [s for s in moving if s.id in set(ls._shipments_for(connection).values_list("id", flat=True))]
            for start in range(0, len(mine), ls._TRACK_CHUNK_SIZE):
                chunk = mine[start:start + ls._TRACK_CHUNK_SIZE]
                rows = ls._track_chunk(connection, [s.tracking_number for s in chunk])
                for shipment in chunk:
                    row = rows.get(shipment.tracking_number)
                    if not row:
                        continue
                    label, reason = ls.row_status_and_reason(row)
                    stage = ls.status_stage(label)
                    order = shipment.order
                    words = sm.sheet_words(stage, attempt=ls.attempt_number(label), reason=reason)
                    line = (f"{order.order_number:<18} {_words(order):<70} -> Leopards: {label!r}"
                            + (f" ({reason})" if reason else "")
                            + (f" => {stage}: {' / '.join(words)}" if words else f" => {stage} (left as is)"))
                    self.stdout.write(line)
                    if apply:
                        with tenant_context(shipment.organization_id):
                            if ls._apply_fetched_status(LeopardsShipment.all_objects.get(id=shipment.id), row):
                                changed += 1
            if apply:
                changed += ls.sync_shipper_advice_requests(connection)

        # 2. Delivered / Returned: words only.
        for shipment in final:
            order = Order.all_objects.get(id=shipment.order_id)
            if order.status == "delivered":
                sub, tag = sm.SUB_DELIVERED
            else:
                sub, tag = sm.SUB_RETURNED
                if order.return_received_at:
                    tag = sm.TAG_RETURN_RECEIVED
            if (order.courier_status, order.courier_tag) == (sub, tag):
                continue
            self.stdout.write(f"{order.order_number:<18} {_words(order):<70} => {sub} / {tag}")
            if apply:
                with tenant_context(order.organization_id):
                    if oms.record_courier_words(order, sub_status=sub, tag=tag):
                        changed += 1

        self.stdout.write(f"== {mode} done: {changed} order(s) changed ==" if apply
                          else "== DRY RUN done - nothing saved. Run with --apply to save. ==")
