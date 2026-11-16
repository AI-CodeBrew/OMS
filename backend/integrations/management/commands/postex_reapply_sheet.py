"""One-time: put every PostEx order already booked on FynkTech's PostEx
status sheet (integrations/postex/status_map.py) - right after the sheet
goes live, so orders don't wait for their next PostEx update.

    python manage.py postex_reapply_sheet            # dry run: shows what would change
    python manage.py postex_reapply_sheet --apply    # saves it

- Booked, not delivered/returned yet (Assigning Courier, Dispatched, Out for
  Delivery, Undelivered, Return in Transit): each parcel is read again from
  PostEx and applied exactly as the poller would.
- Already Delivered / Returned: only the Sub Status and Tag are set
  (Returned: Awaiting Scan, or Return Received once the Returns Desk has it).
"""

from django.core.management.base import BaseCommand

from core.context import tenant_context
from integrations.postex import client
from integrations.postex import services as ps
from integrations.postex import status_map as sm
from integrations.postex.models import PostExConnection, PostExShipment
from oms import services as oms
from oms.models import Order


def _words(order):
    return f"{oms.card_label(order)} / {order.courier_status or '-'} / {oms.latest_tag(order) or '-'}"


class Command(BaseCommand):
    help = "Apply FynkTech's PostEx status sheet to existing PostEx orders (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Save the changes (default: only show them).")

    def handle(self, *args, apply=False, **options):
        mode = "APPLY" if apply else "DRY RUN"
        self.stdout.write(f"== {mode} ==")
        shipments = list(
            PostExShipment.all_objects.filter(is_active=True).exclude(tracking_number="")
            .exclude(order__status="cancelled").select_related("order")
        )
        final = [s for s in shipments if s.order.status in ("delivered", "returned")]
        moving = [s for s in shipments if s.order.status not in ("delivered", "returned")]
        self.stdout.write(f"{len(moving)} not finished (read from PostEx again), {len(final)} delivered/returned")

        # 1. Not finished: read from PostEx again, per account.
        changed = 0
        seen = set()
        for connection in PostExConnection.all_objects.exclude(api_token=""):
            ids = set(ps._shipments_for(connection).values_list("id", flat=True))
            mine = [s for s in moving if s.id in ids and s.id not in seen]
            seen.update(s.id for s in mine)
            for start in range(0, len(mine), ps._TRACK_CHUNK_SIZE):
                chunk = mine[start:start + ps._TRACK_CHUNK_SIZE]
                try:
                    rows = client.track_bulk(connection.api_token, [s.tracking_number for s in chunk])
                except Exception as exc:  # one bad account shouldn't stop the rest
                    self.stdout.write(f"!! PostEx tracking failed for {len(chunk)} parcel(s): {exc}")
                    continue
                for shipment in chunk:
                    row = rows.get(shipment.tracking_number)
                    if not row:
                        continue
                    label = str(row.get("transactionStatus") or "")
                    history = row.get("transactionStatusHistory") or []
                    stage = ps.status_stage(label, history)
                    order = shipment.order
                    words = (sm.pre_pickup_words(label) if oms.workflow_card(order) == "assigning_courier"
                             else sm.sheet_words(stage, label, history))
                    self.stdout.write(
                        f"{order.order_number:<18} {_words(order):<75} -> PostEx: {label!r} => {stage}"
                        + (f": {' / '.join(w or '(print tag)' for w in words)}" if words else " (as PostEx wrote it)")
                    )
                    if apply:
                        with tenant_context(shipment.organization_id):
                            if ps._apply_fetched_status(PostExShipment.all_objects.get(id=shipment.id), row):
                                changed += 1

        # 2. Delivered / Returned: words only.
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
