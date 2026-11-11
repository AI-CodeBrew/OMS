"""One-off: correct orders from a sheet keyed by OMS order ID, fixing only
what each row's "What to Fix" column names.

Sheet columns: OMS (Fynk Tech) Order ID, Actual Courier, Actual Tracking,
Actual Payment Method, Actual Grand Total, Actual COD Amount, Actual
Products, Actual Qty, What to Fix.

What to Fix -> what is written:
  Payment Method     payment_gateway / payment_status / amount_paid, so the
                     method and the amount left to collect match the sheet.
                     A COD order already marked paid (cash collected) stays
                     paid.
  Courier            the courier (matched like the courier sheet import).
  Tracking           tracking_number (skipped if another order of the same
                     store already has it).
  Grand Total (COD), Grand Total
                     total_amount moved so the grand total matches, and the
                     amount to collect from the sheet's COD amount.
  Products/Qty, Qty  the order's items, from "Name xQty | Name xQty".
  Review             nothing - left for a person.

Dry run by default; --apply writes, after saving every touched order's old
values (and items) to a JSON backup that --restore <backup> --apply puts
back. Each corrected order gets one Order Log line saying what changed.
"""

import collections
import csv
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.models import OrganizationAuditLog
from oms.importers import _canonical_courier, _sheet_courier_id
from oms.models import Order, OrderItem

ID = "OMS (Fynk Tech) Order ID"
CENT = Decimal("0.01")
ORDER_FIELDS = [
    "courier_id", "tracking_number", "payment_gateway", "payment_status",
    "amount_paid", "total_amount",
]
KNOWN_FLAGS = {
    "Payment Method", "Courier", "Tracking", "Grand Total (COD)", "Grand Total",
    "Products/Qty", "Products", "Qty", "Review",
}
ACTOR = "FynkTech (sheet correction)"


def money(value):
    value = (value or "").replace(",", "").strip()
    if not value:
        return None
    try:
        return Decimal(value).quantize(CENT)
    except InvalidOperation:
        raise ValueError(f"unreadable amount {value!r}")


def flags_of(text):
    out = set()
    for part in (text or "").split(","):
        for piece in part.split("+"):
            piece = piece.strip()
            if piece:
                out.add(piece)
    return out


def parse_items(text):
    """'A x1 | B x2' -> [("A", 1), ("B", 2)]."""
    items = []
    for part in (text or "").split("|"):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(.*?)\s+x\s*(\d+)$", part, re.I)
        name, qty = (m.group(1).strip(), int(m.group(2))) if m else (part, 1)
        name = re.sub(r"\s{2,}", " ", name)
        items.append((name, qty))
    return items


def fmt(v):
    return "-" if v in (None, "") else str(v)


class Command(BaseCommand):
    help = "Correct orders (payment, courier, tracking, totals, products) from a sheet's What to Fix column."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", nargs="?")
        parser.add_argument("--apply", action="store_true", help="Write (default: dry run).")
        parser.add_argument("--backup", default="", help="Backup JSON path (default: next to the sheet).")
        parser.add_argument("--report", default="", help="Also write every planned change to this CSV.")
        parser.add_argument("--restore", default="", help="Put back the values saved in a backup JSON.")

    # ------------------------------------------------------------------ plan
    def handle(self, *args, **opts):
        if opts["restore"]:
            return self.restore(opts["restore"], opts["apply"])
        if not opts["csv_path"]:
            raise CommandError("Give the sheet's path.")
        path = Path(opts["csv_path"])
        rows = list(csv.DictReader(path.open(encoding="utf-8-sig", newline="")))

        problems, skipped = [], []
        sheet = {}
        for line, r in enumerate(rows, start=2):
            raw = (r.get(ID) or "").strip()
            if not raw.isdigit():
                problems.append(f"line {line}: bad order ID {raw!r}")
                continue
            if re.search(r"E\+\d+$", r.get("Actual Tracking", ""), re.I):
                problems.append(f"line {line}: tracking broken by Excel ({r['Actual Tracking']})")
            unknown = flags_of(r.get("What to Fix")) - KNOWN_FLAGS
            if unknown:
                problems.append(f"line {line}: unknown What to Fix {sorted(unknown)}")
            if int(raw) in sheet:
                problems.append(f"line {line}: order ID {raw} twice")
            sheet[int(raw)] = r
        if problems:
            for p in problems[:30]:
                self.stderr.write(p)
            raise CommandError(f"{len(problems)} problem(s) in the sheet - nothing done.")

        orders = {
            o.supabase_order_no: o
            for o in Order.all_objects.filter(supabase_order_no__in=list(sheet))
            .select_related("courier", "organization")
        }
        # Read straight from the table: order.items goes through the
        # store-scoped manager and is empty outside a store's request.
        items_of = collections.defaultdict(list)
        for item in OrderItem.all_objects.filter(order_id__in=[o.id for o in orders.values()]):
            items_of[item.order_id].append(item)
        missing = sorted(set(sheet) - set(orders))

        # Tracking numbers already on another order of the same store.
        wanted_tracking = {
            (r.get("Actual Tracking") or "").strip()
            for oid, r in sheet.items()
            if "Tracking" in flags_of(r.get("What to Fix")) and (r.get("Actual Tracking") or "").strip()
        }
        taken = collections.defaultdict(set)
        for org_id, tn, no in Order.all_objects.filter(tracking_number__in=wanted_tracking).values_list(
            "organization_id", "tracking_number", "supabase_order_no"
        ):
            taken[(org_id, tn)].add(no)

        plans = []  # (order, {field: new}, items or None, [labels])
        per_flag = collections.Counter()
        for oid, r in sheet.items():
            order = orders.get(oid)
            if order is None:
                continue
            flags = flags_of(r.get("What to Fix"))
            changes, labels, items = {}, [], None
            try:
                gt_file = money(r.get("Actual Grand Total"))
                cod_file = money(r.get("Actual COD Amount"))
            except ValueError as exc:
                skipped.append((oid, str(exc)))
                continue

            if "Courier" in flags:
                name = _canonical_courier(r.get("Actual Courier"))
                current = order.courier.name if order.courier_id else ""
                if not name:
                    skipped.append((oid, "Courier flagged but no courier in sheet"))
                elif _canonical_courier(current) != name:
                    changes["courier_name"] = name
                    labels.append(f"Courier {fmt(current)} → {name}")
                    per_flag["Courier"] += 1

            if "Tracking" in flags:
                tn = (r.get("Actual Tracking") or "").strip()
                others = taken.get((order.organization_id, tn), set()) - {oid}
                if not tn:
                    skipped.append((oid, "Tracking flagged but empty in sheet"))
                elif others:
                    skipped.append((oid, f"tracking {tn} already on order(s) {sorted(others)}"))
                elif tn != order.tracking_number:
                    changes["tracking_number"] = tn
                    labels.append(f"Tracking {fmt(order.tracking_number)} → {tn}")
                    per_flag["Tracking"] += 1

            # Money: grand total first, then the payment it implies.
            total_flag = flags & {"Grand Total (COD)", "Grand Total"}
            pay_flag = "Payment Method" in flags
            new_total = order.total_amount
            gt_now = Decimal(order.grand_total).quantize(CENT)
            if total_flag:
                if gt_file is None:
                    skipped.append((oid, "Grand Total flagged but empty in sheet"))
                elif gt_file != gt_now:
                    new_total = (order.total_amount + (gt_file - gt_now)).quantize(CENT)
                    changes["total_amount"] = new_total
                    labels.append(f"Grand total {gt_now} → {gt_file}")
                    per_flag["Grand Total"] += 1
            gt_new = gt_now + (new_total - order.total_amount)

            if pay_flag or "Grand Total (COD)" in flags:
                method = (r.get("Actual Payment Method") or "").strip() if pay_flag else None
                if method == "Prepaid" and cod_file:
                    skipped.append((oid, f"sheet says Prepaid but COD amount {cod_file} - left for review"))
                elif method not in (None, "COD", "Prepaid", "Partially Paid"):
                    skipped.append((oid, f"unknown payment method {method!r}"))
                else:
                    pay = self.payment_for(order, method, gt_new, cod_file)
                    diff = {k: v for k, v in pay.items() if getattr(order, k) != v}
                    if diff:
                        changes.update(diff)
                        before = f"{order.payment_gateway}/{order.payment_status}, to collect {order.amount_receivable}"
                        after_rec = max(gt_new - order.extra_discount - pay["amount_paid"], Decimal("0"))
                        if pay["payment_status"] == "paid" and not pay["amount_paid"]:
                            after_rec = Decimal("0")
                        labels.append(
                            f"Payment {before} → {pay['payment_gateway']}/{pay['payment_status']}, to collect {after_rec}"
                        )
                        per_flag["Payment / COD"] += 1

            if flags & {"Products/Qty", "Products", "Qty"}:
                items = parse_items(r.get("Actual Products"))
                if not items:
                    skipped.append((oid, "Products flagged but empty in sheet"))
                    items = None
                else:
                    have = sorted((i.product_name, i.quantity) for i in items_of[order.id])
                    if have == sorted(items):
                        items = None
                    else:
                        labels.append(
                            "Products "
                            + (" | ".join(f"{n} x{q}" for n, q in have) or "-")
                            + " → "
                            + " | ".join(f"{n} x{q}" for n, q in items)
                        )
                        per_flag["Products/Qty"] += 1

            if changes or items is not None:
                order._old_items = items_of[order.id]
                plans.append((order, changes, items, labels, gt_new))

        review = sum(1 for r in sheet.values() if "Review" in flags_of(r.get("What to Fix")))
        self.stdout.write(f"Sheet rows: {len(sheet)} | orders found: {len(orders)} | not found: {len(missing)} {missing[:20]}")
        self.stdout.write(f"Orders to correct: {len(plans)}")
        for k, v in per_flag.most_common():
            self.stdout.write(f"  {k}: {v}")
        self.stdout.write(f"Rows flagged Review (only their other flags are applied): {review}")
        self.stdout.write(f"Skipped items: {len(skipped)}")
        for oid, why in skipped[:40]:
            self.stdout.write(f"  #{oid}: {why}")
        for order, _c, _i, labels, _g in plans[:6]:
            self.stdout.write(f"  e.g. #{order.supabase_order_no}: " + "; ".join(labels))

        if opts["report"]:
            with open(opts["report"], "w", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                w.writerow(["OMS ID", "Store", "What to Fix", "Changes"])
                for order, _c, _i, labels, _g in plans:
                    w.writerow([order.supabase_order_no, order.organization.name,
                                sheet[order.supabase_order_no].get("What to Fix"), " ; ".join(labels)])
                for oid, why in skipped:
                    w.writerow([oid, "", sheet[oid].get("What to Fix"), f"SKIPPED: {why}"])
            self.stdout.write(f"Report: {opts['report']}")

        if not opts["apply"]:
            self.stdout.write(self.style.WARNING("Dry run - nothing written. Add --apply to write."))
            return
        if not plans:
            self.stdout.write("Nothing to change.")
            return

        backup = Path(opts["backup"]) if opts["backup"] else path.with_name(
            f"order_corrections_backup_{timezone.now():%Y%m%d_%H%M%S}.json"
        )
        backup.write_text(json.dumps([
            {
                "id": str(order.id),
                "supabase_order_no": order.supabase_order_no,
                "fields": {f: (str(getattr(order, f)) if getattr(order, f) is not None else None) for f in ORDER_FIELDS},
                "items_replaced": items is not None,
                "items": [
                    {"product_name": i.product_name, "quantity": i.quantity, "unit_price": str(i.unit_price),
                     "vendor": i.vendor, "barcode": i.barcode}
                    for i in order._old_items
                ],
            }
            for order, _c, items, _l, _g in plans
        ], indent=1), encoding="utf-8")
        self.stdout.write(f"Old values saved to {backup}")

        self.write(plans)
        self.stdout.write(self.style.SUCCESS(f"Corrected {len(plans)} orders."))

    @staticmethod
    def payment_for(order, method, grand_total, cod):
        """{payment_gateway, payment_status, amount_paid} for the sheet's
        method and COD amount. method None: keep the order's own method
        (a Grand Total (COD) fix)."""
        base = grand_total - order.extra_discount
        if method is None:
            method = (
                "Prepaid" if order.payment_gateway == "cc" and order.payment_status == "paid"
                else "Partially Paid" if order.payment_status == "partially_paid"
                else "COD"
            )
        if method == "Prepaid":
            return {"payment_gateway": "cc", "payment_status": "paid", "amount_paid": max(base, Decimal("0")).quantize(CENT)}
        cod = base if cod is None else cod
        paid = max(base - cod, Decimal("0")).quantize(CENT)
        if method == "Partially Paid":
            status = "partially_paid"
        elif order.payment_status == "paid" and order.payment_gateway == "cod" and not paid:
            # COD with the cash already collected - stays collected.
            status = "paid"
        elif order.payment_status == "paid" and order.status == "delivered" and not paid:
            status = "paid"
        else:
            status = "partially_paid" if paid > 0 else "pending"
        return {"payment_gateway": "cod", "payment_status": status, "amount_paid": paid}

    # ----------------------------------------------------------------- write
    def write(self, plans):
        courier_ids = {}
        to_update = collections.defaultdict(list)
        logs = []
        new_items = []
        replace_ids = []
        with transaction.atomic():
            for order, changes, items, labels, gt_new in plans:
                fields = []
                if "courier_name" in changes:
                    key = (order.organization_id, changes["courier_name"])
                    if key not in courier_ids:
                        courier_ids[key] = _sheet_courier_id(order.organization_id, changes["courier_name"], create=True)
                    order.courier_id = courier_ids[key]
                    fields.append("courier_id")
                for f in ("tracking_number", "total_amount", "payment_gateway", "payment_status", "amount_paid"):
                    if f in changes:
                        setattr(order, f, changes[f])
                        fields.append(f)
                if fields:
                    to_update[tuple(sorted(fields))].append(order)
                if items is not None:
                    replace_ids.append(order.id)
                    total_qty = sum(q for _n, q in items) or 1
                    unit = (gt_new / total_qty).quantize(CENT) if gt_new > 0 else Decimal("0")
                    for name, qty in items:
                        new_items.append(OrderItem(
                            organization_id=order.organization_id, order_id=order.id,
                            product_name=name[:255], quantity=qty, unit_price=unit,
                        ))
                logs.append(OrganizationAuditLog(
                    organization_id=order.organization_id,
                    actor_email=ACTOR,
                    actor_role=OrganizationAuditLog.ROLE_SUPER_ADMIN,
                    action="order.sheet_correction",
                    category="orders",
                    entity_type="order",
                    entity_id=str(order.id),
                    summary=(f"Order {order.order_number}: Corrected from sheet: " + "; ".join(labels))[:500],
                    metadata={"order_number": order.order_number, "via": ACTOR, "changes": labels},
                ))
            for fields, group in to_update.items():
                Order.all_objects.bulk_update(group, list(fields), batch_size=500)
            if replace_ids:
                OrderItem.all_objects.filter(order_id__in=replace_ids).delete()
                OrderItem.all_objects.bulk_create(new_items, batch_size=500)
            OrganizationAuditLog.all_objects.bulk_create(logs, batch_size=500)

    # --------------------------------------------------------------- restore
    def restore(self, backup_path, apply):
        data = json.loads(Path(backup_path).read_text(encoding="utf-8"))
        orders = {str(o.id): o for o in Order.all_objects.filter(id__in=[d["id"] for d in data])}
        self.stdout.write(f"Backup orders: {len(data)}, found: {len(orders)}")
        if not apply:
            self.stdout.write(self.style.WARNING("Dry run - add --apply to restore."))
            return
        with transaction.atomic():
            items, replace = [], []
            for d in data:
                order = orders.get(d["id"])
                if order is None:
                    continue
                for f, v in d["fields"].items():
                    if f in ("amount_paid", "total_amount"):
                        v = Decimal(v)
                    setattr(order, f, v)
                if d["items_replaced"]:
                    replace.append(order.id)
                    for i in d["items"]:
                        items.append(OrderItem(
                            organization_id=order.organization_id, order_id=order.id,
                            product_name=i["product_name"], quantity=i["quantity"],
                            unit_price=Decimal(i["unit_price"]), vendor=i["vendor"], barcode=i["barcode"],
                        ))
            Order.all_objects.bulk_update(list(orders.values()), ORDER_FIELDS, batch_size=500)
            if replace:
                OrderItem.all_objects.filter(order_id__in=replace).delete()
                OrderItem.all_objects.bulk_create(items, batch_size=500)
        self.stdout.write(self.style.SUCCESS(f"Restored {len(orders)} orders."))
