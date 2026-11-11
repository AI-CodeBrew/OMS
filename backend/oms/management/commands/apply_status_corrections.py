"""One-off: set orders' courier, tracking, status (card), sub status and
tag from a sheet keyed by OMS order ID.

Sheet columns: OMS (Fynk Tech) Order ID, Actual Courier, Actual Tracking,
Actual Status, Actual Sub Status, Actual Tag.

"Status" is the card the screens show and "Tag" the card's tag - neither is
stored as such (oms.services.workflow_card / workflow_tag work them out), so
each row is turned into the stored fields that make the order show exactly
that card and tag:
  Delivered            status delivered
  Returned             status returned
  Return in Transit    a returnable status (kept if it already is one, else
                       dispatched) + return_in_progress_at
  Undelivered          status attempt, not in return
  Dispatched           dispatched (In Transit) / out_for_delivery
  Cancelled            status cancelled, cancel_reason = the tag
  Assigning Courier    To Be Packed: kept/made ready_to_print, not packed
  Sub Status           courier_status
  Tag                  for Returned / Return in Transit / Undelivered the
                       tag is the courier's word unless a reason is set -
                       return_reason is set to the tag when needed.
Courier / tracking as in apply_order_corrections. A blank cell changes
nothing. Stock is NOT moved (no courier/stock side effects) - this only
corrects what OMS shows.

  --backup-only   save every listed order's current values and stop
  (default)       dry run
  --apply         write (a backup is always saved first)
  --restore F     put a backup back (with --apply)
"""

import collections
import csv
import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import OrganizationAuditLog
from oms import services as oms
from oms.importers import _canonical_courier, _sheet_courier_id
from oms.models import Order, OrderStatusEvent

ID = "OMS (Fynk Tech) Order ID"
ACTOR = "FynkTech (sheet correction)"
FIELDS = [
    "status", "courier_id", "tracking_number", "courier_status", "return_reason", "cancel_reason",
    "return_in_progress_at", "packed_at", "delivered_at", "returned_at", "workflow_flag",
]
DATE_FIELDS = {"return_in_progress_at", "packed_at", "delivered_at", "returned_at"}
CARD_OF = {v: k for k, v in oms.WORKFLOW_CARD_LABELS.items()}


def show(order):
    return f"{oms.card_label(order)} / {oms.workflow_tag(order) or '-'} / sub {order.courier_status or '-'}"


class Command(BaseCommand):
    help = "Correct orders' courier, tracking, status, sub status and tag from a sheet."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", nargs="?")
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--backup-only", action="store_true")
        parser.add_argument("--backup", default="")
        parser.add_argument("--report", default="")
        parser.add_argument("--restore", default="")

    def handle(self, *args, **opts):
        if opts["restore"]:
            return self.restore(opts["restore"], opts["apply"])
        if not opts["csv_path"]:
            raise CommandError("Give the sheet's path.")
        path = Path(opts["csv_path"])
        rows = list(csv.DictReader(path.open(encoding="utf-8-sig", newline="")))
        problems = []
        sheet = {}
        for line, r in enumerate(rows, start=2):
            raw = (r.get(ID) or "").strip()
            if not raw.isdigit():
                problems.append(f"line {line}: bad order ID {raw!r}")
                continue
            if re.search(r"E\+\d+$", r.get("Actual Tracking", ""), re.I):
                problems.append(f"line {line}: tracking broken by Excel")
            st = (r.get("Actual Status") or "").strip()
            if st and st not in CARD_OF:
                problems.append(f"line {line}: unknown status {st!r}")
            if int(raw) in sheet:
                problems.append(f"line {line}: order ID {raw} twice")
            sheet[int(raw)] = r
        if problems:
            for p in problems[:30]:
                self.stderr.write(p)
            raise CommandError(f"{len(problems)} problem(s) in the sheet - nothing done.")

        orders = {
            o.supabase_order_no: o
            for o in Order.all_objects.filter(supabase_order_no__in=list(sheet)).select_related("courier", "organization")
        }
        missing = sorted(set(sheet) - set(orders))

        backup_path = Path(opts["backup"]) if opts["backup"] else path.with_name(
            f"status_corrections_backup_{timezone.now():%Y%m%d_%H%M%S}.json"
        )
        if opts["backup_only"] or opts["apply"]:
            self.save_backup(backup_path, orders.values())
            if opts["backup_only"]:
                self.stdout.write(self.style.SUCCESS(
                    f"Backup of {len(orders)} orders saved to {backup_path} (not found: {len(missing)} {missing[:20]})"
                ))
                return

        tracks = {(r.get("Actual Tracking") or "").strip() for r in sheet.values()} - {""}
        taken = collections.defaultdict(set)
        for org, tn, no in Order.all_objects.filter(tracking_number__in=tracks).values_list(
            "organization_id", "tracking_number", "supabase_order_no"
        ):
            taken[(org, tn)].add(no)

        plans, skipped = [], []
        per = collections.Counter()
        for no, r in sheet.items():
            o = orders.get(no)
            if o is None:
                continue
            before = show(o)
            ch, notes = {}, []
            courier = _canonical_courier(r.get("Actual Courier"))
            if courier and _canonical_courier(o.courier.name if o.courier_id else "") != courier:
                ch["courier_name"] = courier
                notes.append(f"Courier {o.courier.name if o.courier_id else '-'} → {courier}")
            tn = (r.get("Actual Tracking") or "").strip()
            if tn and tn != o.tracking_number:
                others = taken.get((o.organization_id, tn), set()) - {no}
                if others:
                    skipped.append((no, f"tracking {tn} already on order(s) {sorted(others)}"))
                else:
                    ch["tracking_number"] = tn
                    notes.append(f"Tracking {o.tracking_number or '-'} → {tn}")
            sub = (r.get("Actual Sub Status") or "").strip()
            tag = (r.get("Actual Tag") or "").strip()
            card = CARD_OF.get((r.get("Actual Status") or "").strip())

            new = {f: getattr(o, f) for f in FIELDS}
            if "tracking_number" in ch:
                new["tracking_number"] = ch["tracking_number"]
            if sub:
                new["courier_status"] = sub
            now = timezone.now()
            if card == "delivered":
                new["status"] = "delivered"
                new["return_in_progress_at"] = None
            elif card == "returned":
                new["status"] = "returned"
            elif card == "return_in_transit":
                if new["status"] not in oms.RETURNABLE_STATUSES:
                    new["status"] = "dispatched"
                new["return_in_progress_at"] = new["return_in_progress_at"] or now
            elif card == "undelivered":
                new["status"] = "attempt"
                new["return_in_progress_at"] = None
            elif card == "dispatched":
                new["status"] = "out_for_delivery" if tag.lower() == "out for delivery" else "dispatched"
                new["return_in_progress_at"] = None
            elif card == "cancelled":
                new["status"] = "cancelled"
                if tag:
                    new["cancel_reason"] = tag
            elif card == "assigning_courier":
                if new["status"] not in oms.WORKFLOW_CARD_STATUSES["assigning_courier"] or new["status"] in ("booking_pending", "dispatch_issue"):
                    new["status"] = "ready_to_print"
                if tag.lower() == "to be packed":
                    new["packed_at"] = None
                elif tag.lower() == "packed" and not new["packed_at"]:
                    new["packed_at"] = now
            elif card:
                skipped.append((no, f"status {r.get('Actual Status')!r} not handled"))
                continue
            # Tag: returned / return in transit / undelivered show the
            # return reason, else the courier's word.
            if tag and card in ("returned", "return_in_transit"):
                if ((new["return_reason"] or "").strip() or new["courier_status"]) != tag:
                    new["return_reason"] = tag
            if tag and card == "undelivered" and (new["courier_status"] or "") != tag:
                new["courier_status"] = tag  # undelivered's tag is the courier word itself

            # Check the result reads exactly as the sheet says.
            probe = Order(**{f: v for f, v in new.items() if f != "courier_id"},
                          delivery_attempts=o.delivery_attempts, tag=o.tag)
            got_card = oms.WORKFLOW_CARD_LABELS.get(oms.workflow_card(probe), "")
            got_tag = oms.workflow_tag(probe)
            if card and got_card != r["Actual Status"].strip():
                skipped.append((no, f"would show {got_card!r}, not {r['Actual Status']!r}"))
                continue
            if tag and got_tag != tag:
                skipped.append((no, f"would show tag {got_tag!r}, not {tag!r}"))
                continue

            diff = {f: v for f, v in new.items() if f != "courier_id" and v != getattr(o, f)}
            for f, v in diff.items():
                if f == "tracking_number":
                    continue
                notes.append(f"{f.replace('_', ' ').capitalize()} {getattr(o, f) or '-'} → {v or '-'}")
            ch.update(diff)
            if ch:
                after = f"{got_card} / {got_tag or '-'} / sub {new['courier_status'] or '-'}"
                plans.append((o, ch, notes, before, after))
                for k in ch:
                    per[k] += 1

        self.stdout.write(f"Sheet rows: {len(sheet)} | found: {len(orders)} | not found: {len(missing)} {missing[:20]}")
        self.stdout.write(f"Orders to change: {len(plans)} | already right: {len(orders) - len(plans) - len(skipped)}")
        for k, v in per.most_common():
            self.stdout.write(f"  {k}: {v}")
        self.stdout.write(f"Skipped: {len(skipped)}")
        for no, why in skipped[:40]:
            self.stdout.write(f"  #{no}: {why}")
        moves = collections.Counter((b.split(" / ")[0], a.split(" / ")[0]) for _o, _c, _n, b, a in plans)
        self.stdout.write("Status moves (now -> file):")
        for (b, a), v in moves.most_common():
            self.stdout.write(f"  {v:4}  {b} -> {a}")
        for o, _c, notes, b, a in plans[:6]:
            self.stdout.write(f"  e.g. #{o.supabase_order_no} {o.order_number}: [{b}] -> [{a}] | " + "; ".join(notes))
        if opts["report"]:
            with open(opts["report"], "w", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                w.writerow(["OMS ID", "Order #", "Store", "Now (status / tag / sub)", "After", "Changes"])
                for o, _c, notes, b, a in plans:
                    w.writerow([o.supabase_order_no, o.order_number, o.organization.name, b, a, " ; ".join(notes)])
                for no, why in skipped:
                    w.writerow([no, "", "", "", "SKIPPED", why])
            self.stdout.write(f"Report: {opts['report']}")

        if not opts["apply"]:
            self.stdout.write(self.style.WARNING("Dry run - nothing written. Add --apply to write."))
            return
        self.write(plans)
        self.stdout.write(self.style.SUCCESS(f"Changed {len(plans)} orders. Backup: {backup_path}"))

    def save_backup(self, path, orders):
        data = [
            {"id": str(o.id), "supabase_order_no": o.supabase_order_no, "order_number": o.order_number,
             "fields": {f: (getattr(o, f).isoformat() if f in DATE_FIELDS and getattr(o, f)
                            else (str(getattr(o, f)) if getattr(o, f) is not None else None)) for f in FIELDS}}
            for o in orders
        ]
        path.write_text(json.dumps(data, indent=1), encoding="utf-8")

    def write(self, plans):
        courier_ids = {}
        groups = collections.defaultdict(list)
        events, logs = [], []
        with transaction.atomic():
            for o, ch, notes, before, after in plans:
                old_status = o.status
                fields = []
                if "courier_name" in ch:
                    key = (o.organization_id, ch["courier_name"])
                    if key not in courier_ids:
                        courier_ids[key] = _sheet_courier_id(o.organization_id, ch["courier_name"], create=True)
                    o.courier_id = courier_ids[key]
                    fields.append("courier_id")
                for f in FIELDS:
                    if f in ch:
                        setattr(o, f, ch[f])
                        fields.append(f)
                groups[tuple(sorted(set(fields)))].append(o)
                if o.status != old_status:
                    events.append(OrderStatusEvent(
                        organization_id=o.organization_id, order_id=o.id, from_status=old_status,
                        to_status=o.status, note="Corrected from sheet",
                    ))
                logs.append(OrganizationAuditLog(
                    organization_id=o.organization_id, actor_email=ACTOR,
                    actor_role=OrganizationAuditLog.ROLE_SUPER_ADMIN, action="order.sheet_correction",
                    category="orders", entity_type="order", entity_id=str(o.id),
                    summary=(f"Order {o.order_number}: Corrected from sheet: [{before}] → [{after}]; " + "; ".join(notes))[:500],
                    metadata={"order_number": o.order_number, "via": ACTOR, "changes": notes, "before": before, "after": after},
                ))
            for fields, group in groups.items():
                Order.all_objects.bulk_update(group, list(fields), batch_size=500)
            OrderStatusEvent.all_objects.bulk_create(events, batch_size=500)
            OrganizationAuditLog.all_objects.bulk_create(logs, batch_size=500)

    def restore(self, backup_path, apply):
        data = json.loads(Path(backup_path).read_text(encoding="utf-8"))
        orders = {str(o.id): o for o in Order.all_objects.filter(id__in=[d["id"] for d in data])}
        for d in data:
            o = orders.get(d["id"])
            if not o:
                continue
            for f, v in d["fields"].items():
                setattr(o, f, parse_datetime(v) if f in DATE_FIELDS and v else v if v is not None else (None if f in DATE_FIELDS or f == "courier_id" else ""))
        self.stdout.write(f"Backup orders: {len(data)}, found: {len(orders)}")
        if not apply:
            self.stdout.write(self.style.WARNING("Dry run - add --apply to restore."))
            return
        with transaction.atomic():
            Order.all_objects.bulk_update(list(orders.values()), FIELDS, batch_size=500)
        self.stdout.write(self.style.SUCCESS(f"Restored {len(orders)} orders."))
