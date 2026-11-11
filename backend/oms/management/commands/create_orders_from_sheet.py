"""One-off: create orders (replacements of existing orders) from a sheet,
in their own stores.

Sheet columns: Store Name, Store Order ID, Parent Store Order ID, Parent
OMS Order ID, Courier Order ID, Order Date (PKT), Customer Name, Phone,
Address, City, Product Name, Quantity, Unit Price, Grand Total, Order Type,
Total Receivable, Order Status, Sub Status, Tag, Courier Name, Tracking
Number, Booked At (PKT), Picked At (PKT), Delivered At (PKT), Returned At
(PKT), Courier Remittance Date, Source. One row per product; rows with the
same store + Store Order ID are one order.

Each order is written straight to the tables - a Replacement of its parent
(recreate_type="replacement", recreated_from=parent) - with no order.created
event, so nothing is booked, synced or taken from stock. Courier Order ID,
remittance date and source go into the order's note. A product named like
the parent's (ignoring spaces, &, ™, dashes) takes the parent's exact name
and SKU.

Dry run by default; --apply creates them and saves the new order ids to a
JSON so --undo <file> --apply can delete exactly those orders again.
"""

import collections
import csv
import json
import re
import zoneinfo
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.models import Organization, OrganizationAuditLog
from oms import services as oms
from oms.importers import _canonical_courier, _sheet_courier_id
from oms.models import Order, OrderItem, OrderNote, OrderStatusEvent

PKT = zoneinfo.ZoneInfo("Asia/Karachi")
ACTOR = "FynkTech (sheet import)"
STORE_ALIASES = {
    "useandkeep": "Fynktech",
    "halora": "Shop Halora",
    "onestation": "One Stations",
    "playback": "Playback Store",
    "maisonnor": "Maisonnor",
}
STATUS_OF = {"Delivered": "delivered", "Returned": "returned", "Cancelled": "cancelled"}


def key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def money(s):
    s = (s or "").replace(",", "").strip()
    return Decimal(s or "0").quantize(Decimal("0.01"))


def when(s):
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=PKT)
        except ValueError:
            continue
    raise ValueError(f"unreadable date {s!r}")


class Command(BaseCommand):
    help = "Create (replacement) orders from a sheet in their stores."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", nargs="?")
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--created-file", default="")
        parser.add_argument("--undo", default="")

    def handle(self, *args, **opts):
        if opts["undo"]:
            return self.undo(opts["undo"], opts["apply"])
        path = Path(opts["csv_path"])
        rows = list(csv.DictReader(path.open(encoding="utf-8-sig", newline="")))
        stores = {key(o.name): o for o in Organization.objects.filter(is_platform=False)}

        groups = collections.OrderedDict()
        for r in rows:
            groups.setdefault((r["Store Name"].strip(), r["Store Order ID"].strip()), []).append(r)

        plans, problems = [], []
        for (store_name, number), lines in groups.items():
            r = lines[0]
            org = stores.get(key(STORE_ALIASES.get(key(store_name), store_name)))
            if org is None:
                problems.append(f"{number}: store {store_name!r} not found")
                continue
            if Order.all_objects.filter(organization_id=org.id, order_number=number).exists():
                problems.append(f"{number}: already exists in {org.name}")
                continue
            parent = Order.all_objects.filter(supabase_order_no=int(r["Parent OMS Order ID"])).first()
            if parent is None or parent.organization_id != org.id:
                problems.append(f"{number}: parent OMS {r['Parent OMS Order ID']} not found in {org.name}")
                continue
            tn = r["Tracking Number"].strip()
            if tn and Order.all_objects.filter(organization_id=org.id, tracking_number=tn).exists():
                problems.append(f"{number}: tracking {tn} already on another order")
                continue
            status = STATUS_OF.get(r["Order Status"].strip())
            if not status:
                problems.append(f"{number}: status {r['Order Status']!r} not handled")
                continue
            try:
                dates = {
                    "placed_at": when(r["Order Date (PKT)"]),
                    "booked_at": when(r["Booked At (PKT)"]),
                    "dispatched_at": when(r["Picked At (PKT)"]),
                    "delivered_at": when(r["Delivered At (PKT)"]),
                    "returned_at": when(r["Returned At (PKT)"]),
                }
                remit = r.get("Courier Remittance Date", "").strip()
            except ValueError as exc:
                problems.append(f"{number}: {exc}")
                continue

            parent_items = {key(i.product_name): i for i in OrderItem.all_objects.filter(order_id=parent.id)}
            items, renamed = [], []
            for line in lines:
                name = re.sub(r"\s{2,}", " ", line["Product Name"].strip())
                pi = parent_items.get(key(name))
                if pi and pi.product_name != name:
                    renamed.append(f"{name} → {pi.product_name}")
                items.append({
                    "product_name": pi.product_name if pi else name,
                    "barcode": pi.barcode if pi else "",
                    "quantity": int(line["Quantity"] or 1),
                    "unit_price": money(line["Unit Price"]),
                })
            grand = money(r["Grand Total"])
            receivable = money(r["Total Receivable"])
            prepaid = r["Order Type"].strip().lower() != "cod"
            sub, tag = r["Sub Status"].strip(), r["Tag"].strip()
            fields = {
                "organization_id": org.id,
                "order_number": number,
                "customer_name": r["Customer Name"].strip(),
                "customer_phone": r["Phone"].strip(),
                "address_line1": r["Address"].strip()[:255],
                "city": r["City"].strip(),
                "country": parent.country or "Pakistan",
                "customer_email": parent.customer_email,
                "status": status,
                "courier_status": sub,
                "tracking_number": tn,
                "total_amount": grand,
                "payment_gateway": "cc" if prepaid else "cod",
                "payment_status": "paid" if prepaid else "pending",
                "amount_paid": grand if prepaid else max(grand - receivable, Decimal("0")),
                "fulfillment_status": "fulfilled",
                "order_source": "Manual",
                "shop": parent.shop or oms.default_store_name(org.id),
                "recreate_type": "replacement",
                "recreated_from_id": parent.id,
                **{k: v for k, v in dates.items() if v},
            }
            if status == "returned" and tag and tag != sub:
                fields["return_reason"] = tag
            if status == "cancelled" and tag:
                fields["cancel_reason"] = tag

            # Check it reads as the sheet says.
            probe = Order(**{k: v for k, v in fields.items() if k not in ("organization_id", "recreated_from_id")})
            got = (oms.WORKFLOW_CARD_LABELS.get(oms.workflow_card(probe)), oms.workflow_tag(probe))
            if got != (r["Order Status"].strip(), tag or got[1]):
                problems.append(f"{number}: would show {got}, sheet says {(r['Order Status'], tag)}")
                continue
            note = "Created from sheet (replacement of {}, OMS {}). Courier Order ID: {}. Source: {}.{}".format(
                parent.order_number, parent.supabase_order_no, r["Courier Order ID"].strip() or "-",
                r.get("Source", "").strip() or "-", f" Courier remittance: {remit}." if remit else "",
            )
            plans.append((org, parent, fields, items, r["Courier Name"].strip(), note, renamed))

        self.stdout.write(f"Orders in sheet: {len(groups)} | to create: {len(plans)} | problems: {len(problems)}")
        for p in problems:
            self.stdout.write(f"  PROBLEM {p}")
        by = collections.Counter((o.name, f["status"]) for o, _p, f, *_ in plans)
        for k, v in sorted(by.items()):
            self.stdout.write(f"  {v:3}  {k[0]} - {k[1]}")
        for org, parent, f, items, courier, note, renamed in plans:
            self.stdout.write(
                f"  {org.name:14} {f['order_number']:18} ← {parent.order_number:12} {f['status']:9} "
                f"{f['payment_gateway']}/{f['payment_status']} total {f['total_amount']} collect "
                f"{f['total_amount'] - f['amount_paid']} | {courier} {f['tracking_number']} | "
                + " | ".join(f"{i['product_name']} x{i['quantity']}" for i in items)
                + (f"  [renamed: {'; '.join(renamed)}]" if renamed else "")
            )
        if problems:
            raise CommandError("Fix the problems first - nothing created.")
        if not opts["apply"]:
            self.stdout.write(self.style.WARNING("Dry run - nothing created. Add --apply to create."))
            return

        created = []
        with transaction.atomic():
            for org, parent, fields, items, courier, note, renamed in plans:
                name = _canonical_courier(courier)
                if name:
                    fields["courier_id"] = _sheet_courier_id(org.id, name, create=True)
                order = Order.all_objects.create(**fields)
                OrderItem.all_objects.bulk_create([
                    OrderItem(organization_id=org.id, order=order, **i) for i in items
                ])
                OrderNote.all_objects.create(organization_id=org.id, order=order, kind="note", body=note)
                OrderStatusEvent.all_objects.create(
                    organization_id=org.id, order=order, from_status="new", to_status=order.status,
                    note="Created from sheet",
                )
                OrganizationAuditLog.all_objects.create(
                    organization_id=org.id, actor_email=ACTOR,
                    actor_role=OrganizationAuditLog.ROLE_SUPER_ADMIN, action="order.created",
                    category="orders", entity_type="order", entity_id=str(order.id),
                    summary=f"Order {order.order_number}: Created from sheet as a replacement of {parent.order_number}",
                    metadata={"order_number": order.order_number, "via": ACTOR},
                )
                order.refresh_from_db(fields=["supabase_order_no"])
                created.append({"id": str(order.id), "order_number": order.order_number,
                                "store": org.name, "supabase_order_no": order.supabase_order_no})
        out = Path(opts["created_file"]) if opts["created_file"] else path.with_name(
            f"created_orders_{timezone.now():%Y%m%d_%H%M%S}.json"
        )
        out.write_text(json.dumps(created, indent=1), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Created {len(created)} orders. List: {out}"))
        for c in created:
            self.stdout.write(f"  {c['store']:14} {c['order_number']:18} OMS ID {c['supabase_order_no']}")

    def undo(self, path, apply):
        created = json.loads(Path(path).read_text(encoding="utf-8"))
        ids = [c["id"] for c in created]
        self.stdout.write(f"Orders to delete: {Order.all_objects.filter(id__in=ids).count()} of {len(ids)}")
        if not apply:
            self.stdout.write(self.style.WARNING("Dry run - add --apply to delete."))
            return
        with transaction.atomic():
            OrganizationAuditLog.all_objects.filter(entity_type="order", entity_id__in=ids).delete()
            Order.all_objects.filter(id__in=ids).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {len(ids)} orders."))
