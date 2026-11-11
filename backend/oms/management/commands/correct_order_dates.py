"""One-off: correct orders' dates from a sheet keyed by OMS order ID.

Sheet columns (header row required):
  OMS (Fynk Tech) Order ID, Actual Order Date, Actual Booking Date,
  Actual Pickup Date, Actual Delivered Date, Actual Returned Date

Each row updates the order whose supabase_order_no is exactly that ID; IDs
with no order are skipped and listed. A blank cell leaves that date as it
is. Times are Pakistan time (same as the courier sheet imports).

Dry run by default - pass --apply to write. Before writing, every touched
order's old values are saved to a backup CSV, so the change can be undone
with --restore <backup.csv> --apply.
"""

import csv
import zoneinfo
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from oms.models import Order

SHEET_TZ = zoneinfo.ZoneInfo("Asia/Karachi")
ID_COLUMN = "OMS (Fynk Tech) Order ID"
COLUMNS = {
    "Actual Order Date": "placed_at",
    "Actual Booking Date": "booked_at",
    "Actual Pickup Date": "dispatched_at",
    "Actual Delivered Date": "delivered_at",
    "Actual Returned Date": "returned_at",
}
FIELDS = list(COLUMNS.values())
FORMATS = ("%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y")
BATCH = 500


def parse(value):
    value = (value or "").strip()
    if not value:
        return None
    for fmt in FORMATS:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=SHEET_TZ)
        except ValueError:
            continue
    raise ValueError(f"unreadable date {value!r}")


class Command(BaseCommand):
    help = "Correct order dates (placed/booked/dispatched/delivered/returned) from a sheet by OMS order ID."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", nargs="?", help="The corrections sheet (CSV).")
        parser.add_argument("--apply", action="store_true", help="Write the changes (default: dry run).")
        parser.add_argument("--backup", default="", help="Where to save the old values (default: next to the sheet).")
        parser.add_argument("--restore", default="", help="A backup CSV from an earlier run - put those values back.")

    def handle(self, *args, **opts):
        if opts["restore"]:
            return self.restore(opts["restore"], opts["apply"])
        if not opts["csv_path"]:
            raise CommandError("Give the sheet's path.")
        path = Path(opts["csv_path"])

        wanted = {}  # oms id -> {field: datetime}
        errors = []
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            missing_cols = [c for c in [ID_COLUMN, *COLUMNS] if c not in (reader.fieldnames or [])]
            if missing_cols:
                raise CommandError(f"Sheet is missing columns: {missing_cols}")
            for line, row in enumerate(reader, start=2):
                raw_id = (row[ID_COLUMN] or "").strip()
                if not raw_id.isdigit():
                    errors.append(f"line {line}: bad order ID {raw_id!r}")
                    continue
                values = {}
                for col, field in COLUMNS.items():
                    try:
                        value = parse(row[col])
                    except ValueError as exc:
                        errors.append(f"line {line} ({col}): {exc}")
                        continue
                    if value is not None:
                        values[field] = value
                if int(raw_id) in wanted:
                    errors.append(f"line {line}: order ID {raw_id} appears twice")
                wanted[int(raw_id)] = values

        if errors:
            for e in errors[:50]:
                self.stderr.write(e)
            raise CommandError(f"{len(errors)} problem(s) in the sheet - nothing written.")

        orders = {
            o.supabase_order_no: o
            for o in Order.all_objects.filter(supabase_order_no__in=list(wanted)).only("id", "supabase_order_no", *FIELDS)
        }
        not_found = sorted(set(wanted) - set(orders))

        changed = []  # (order, {field: (old, new)})
        per_field = {f: 0 for f in FIELDS}
        for oms_id, values in wanted.items():
            order = orders.get(oms_id)
            if order is None:
                continue
            diff = {}
            for field, new in values.items():
                old = getattr(order, field)
                if old != new:
                    diff[field] = (old, new)
                    per_field[field] += 1
            if diff:
                changed.append((order, diff))

        self.stdout.write(f"Sheet rows: {len(wanted)}")
        self.stdout.write(f"Orders found (exact OMS ID): {len(orders)}")
        self.stdout.write(f"Not found - skipped: {len(not_found)}")
        if not_found:
            self.stdout.write("  " + ", ".join(map(str, not_found[:100])) + (" …" if len(not_found) > 100 else ""))
        self.stdout.write(f"Orders with a date to change: {len(changed)}")
        for field, n in per_field.items():
            self.stdout.write(f"  {field}: {n}")
        for order, diff in changed[:5]:
            self.stdout.write(
                f"  e.g. #{order.supabase_order_no}: "
                + "; ".join(f"{k} {fmt(o)} -> {fmt(n)}" for k, (o, n) in diff.items())
            )

        if not opts["apply"]:
            self.stdout.write(self.style.WARNING("Dry run - nothing written. Add --apply to write."))
            return
        if not changed:
            self.stdout.write("Nothing to change.")
            return

        backup = Path(opts["backup"]) if opts["backup"] else path.with_name(
            f"order_dates_backup_{timezone.now():%Y%m%d_%H%M%S}.csv"
        )
        with backup.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["id", "supabase_order_no", *FIELDS])
            for order, _ in changed:
                w.writerow([order.id, order.supabase_order_no, *[iso(getattr(order, fld)) for fld in FIELDS]])
        self.stdout.write(f"Old values saved to {backup}")

        self.write(changed)
        self.stdout.write(self.style.SUCCESS(f"Updated {len(changed)} orders."))

    def write(self, changed):
        # bulk_update writes only these columns - no save() side effects,
        # and updated_at is left alone.
        by_fields = {}
        for order, diff in changed:
            for field, (_, new) in diff.items():
                setattr(order, field, new)
            by_fields.setdefault(tuple(sorted(diff)), []).append(order)
        with transaction.atomic():
            for fields, group in by_fields.items():
                Order.all_objects.bulk_update(group, list(fields), batch_size=BATCH)

    def restore(self, backup_path, apply):
        rows = list(csv.DictReader(Path(backup_path).open(encoding="utf-8", newline="")))
        orders = {str(o.id): o for o in Order.all_objects.filter(id__in=[r["id"] for r in rows]).only("id", *FIELDS)}
        for r in rows:
            order = orders.get(r["id"])
            if order is None:
                continue
            for field in FIELDS:
                setattr(order, field, datetime.fromisoformat(r[field]) if r[field] else None)
        self.stdout.write(f"Backup rows: {len(rows)}, orders found: {len(orders)}")
        if not apply:
            self.stdout.write(self.style.WARNING("Dry run - add --apply to restore."))
            return
        with transaction.atomic():
            Order.all_objects.bulk_update(list(orders.values()), FIELDS, batch_size=BATCH)
        self.stdout.write(self.style.SUCCESS(f"Restored {len(orders)} orders."))


def iso(value):
    return value.isoformat() if value else ""


def fmt(value):
    return timezone.localtime(value, SHEET_TZ).strftime("%Y-%m-%d %H:%M") if value else "-"
