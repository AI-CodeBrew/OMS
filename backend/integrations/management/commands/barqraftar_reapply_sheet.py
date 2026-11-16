"""One-time: put every BarqRaftar order already picked up on FynkTech's
BarqRaftar status sheet (integrations/barqraftar/status_map.py) - right
after the sheet goes live, so orders don't wait for their next update.

    python manage.py barqraftar_reapply_sheet            # dry run: shows what would change
    python manage.py barqraftar_reapply_sheet --apply    # saves it

- Not delivered/returned yet: each parcel is read again from BarqRaftar and
  applied exactly as the poller would (so a Return Confirmation parcel
  moves from Return in Transit to Undelivered / Waiting for Shipper Advice).
- Already Delivered / Returned: only the Sub Status and Tag are set
  (Returned: Awaiting Scan, or Return Received once the Returns Desk has it).
- Not picked up yet: untouched.
"""

from django.core.management.base import BaseCommand

from core.context import tenant_context
from integrations.barqraftar import client
from integrations.barqraftar import services as bs
from integrations.barqraftar import status_map as sm
from integrations.barqraftar.models import BarqRaftarConnection, BarqRaftarShipment
from oms import services as oms
from oms.models import Order

CHUNK = 50


def _words(order):
    return f"{oms.card_label(order)} / {order.courier_status or '-'} / {oms.latest_tag(order) or '-'}"


class Command(BaseCommand):
    help = "Apply FynkTech's BarqRaftar status sheet to existing BarqRaftar orders (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Save the changes (default: only show them).")

    def handle(self, *args, apply=False, **options):
        mode = "APPLY" if apply else "DRY RUN"
        self.stdout.write(f"== {mode} ==")
        shipments = list(
            BarqRaftarShipment.all_objects.filter(is_active=True).exclude(tracking_number="")
            .exclude(order__status="cancelled").select_related("order")
        )
        final = [s for s in shipments if s.order.status in ("delivered", "returned")]
        moving = [s for s in shipments if s.order.status in ("dispatched", "out_for_delivery", "attempt")]
        self.stdout.write(f"{len(moving)} with BarqRaftar (read again), {len(final)} delivered/returned, "
                          f"{len(shipments) - len(moving) - len(final)} not picked up (left alone)")

        changed = 0
        seen = set()
        for connection in BarqRaftarConnection.all_objects.exclude(api_key=""):
            ids = set(bs._shipments_for(connection).values_list("id", flat=True))
            mine = {s.tracking_number: s for s in moving if s.id in ids and s.id not in seen}
            seen.update(s.id for s in mine.values())
            numbers = list(mine)
            for start in range(0, len(numbers), CHUNK):
                chunk = numbers[start:start + CHUNK]
                try:
                    rows = client.get_multiple_orders(connection.api_key, connection.api_secret, chunk)
                except Exception as exc:  # one bad account shouldn't stop the rest
                    self.stdout.write(f"!! BarqRaftar read failed for {len(chunk)} parcel(s): {exc}")
                    continue
                for row in rows:
                    tn, _ref, code, label, _logs = bs._extract_order_fields(row)
                    shipment = mine.get(tn)
                    if not shipment:
                        continue
                    order = shipment.order
                    remark = sm.clean_remark(row.get("remarks")) if isinstance(row, dict) else ""
                    words = sm.sheet_words(code, remark)
                    self.stdout.write(
                        f"{order.order_number:<18} {_words(order):<75} -> BarqRaftar: {label!r} ({code})"
                        + (f" => {' / '.join(words)}" if words else " (as BarqRaftar wrote it)")
                    )
                    if apply:
                        with tenant_context(shipment.organization_id):
                            if bs._apply_fetched_status(BarqRaftarShipment.all_objects.get(id=shipment.id), row):
                                changed += 1

        for shipment in final:
            order = Order.all_objects.get(id=shipment.order_id)
            sub, tag = sm.SUB_DELIVERED if order.status == "delivered" else sm.SUB_RETURNED
            if (order.courier_status, order.courier_tag) == (sub, tag):
                continue
            self.stdout.write(f"{order.order_number:<18} {_words(order):<75} => {sub} / {tag}")
            if apply:
                with tenant_context(order.organization_id):
                    if oms.record_courier_words(order, sub_status=sub, tag=tag):
                        changed += 1

        self.stdout.write(f"== {mode} done: {changed} order(s) changed ==" if apply
                          else "== DRY RUN done - nothing saved. Run with --apply to save. ==")
