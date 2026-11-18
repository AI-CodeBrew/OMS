"""Loads the organization's product name -> SKU list (oms.models.ProductSku)
from a CSV: store, product name (exact), SKU - e.g. the user's
OMS_product_names_and_SKUs file. A dry run unless --apply.

    python manage.py import_product_skus file.csv --org "Use & Keep=Fynktech" [--apply]

The store column is an organization's name; --org maps a name used in the
file to the organization's real name. A name already on a store's list
gets the file's SKU. --orders also puts the SKU on that store's existing
order lines with the exact name (their SKU only - nothing else changes).
"""

import csv

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Organization
from oms.models import OrderItem, ProductSku


class Command(BaseCommand):
    help = "Load product name -> SKU rows (store, product name, SKU) from a CSV."

    def add_arguments(self, parser):
        parser.add_argument("csv_path")
        parser.add_argument("--org", action="append", default=[], help='"Name in file=Organization name"')
        parser.add_argument("--orders", action="store_true", help="Also set the SKU on existing order lines")
        parser.add_argument("--apply", action="store_true")

    def handle(self, csv_path, org, orders, apply, **options):
        aliases = {}
        for pair in org:
            left, sep, right = pair.partition("=")
            if not sep:
                raise CommandError(f"--org needs Name=Organization, got {pair!r}")
            aliases[left.strip().lower()] = right.strip()

        with open(csv_path, encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.reader(handle))[1:]
        wanted = {}
        for line, row in enumerate(rows, start=2):
            if len(row) < 3 or not row[1] or not row[2].strip():
                continue
            store, name, sku = row[0].strip(), row[1][:255], row[2].strip()[:100]
            org_name = aliases.get(store.lower(), store)
            organization = Organization.objects.filter(name__iexact=org_name).first()
            if organization is None:
                raise CommandError(f"Line {line}: no organization named {org_name!r}")
            key = (str(organization.id), name)
            if key in wanted and wanted[key][1] != sku:
                raise CommandError(f"Line {line}: {name!r} has two SKUs ({wanted[key][1]}, {sku})")
            wanted[key] = (organization.name, sku)

        existing = {
            (str(o), n): s for o, n, s in ProductSku.all_objects.filter(
                organization_id__in={k[0] for k in wanted}
            ).values_list("organization_id", "product_name", "sku")
        }
        new = [k for k in wanted if k not in existing]
        changed = [k for k in wanted if k in existing and existing[k] != wanted[k][1]]
        self.stdout.write(f"{len(wanted)} names: {len(new)} new, {len(changed)} SKU changed, "
                          f"{len(wanted) - len(new) - len(changed)} already the same")
        for org_id, name in changed:
            self.stdout.write(f"  {wanted[(org_id, name)][0]} | {name}: {existing[(org_id, name)]} -> {wanted[(org_id, name)][1]}")

        lines = 0
        if orders:
            for (org_id, name), (_org, sku) in wanted.items():
                lines += OrderItem.all_objects.filter(organization_id=org_id, product_name=name).exclude(barcode=sku).count()
            self.stdout.write(f"order lines to get the SKU: {lines}")

        if not apply:
            self.stdout.write("Dry run - nothing saved. Add --apply to save.")
            return
        with transaction.atomic():
            for (org_id, name), (_org, sku) in wanted.items():
                ProductSku.all_objects.update_or_create(
                    organization_id=org_id, product_name=name, defaults={"sku": sku}
                )
                if orders:
                    OrderItem.all_objects.filter(organization_id=org_id, product_name=name).exclude(barcode=sku).update(barcode=sku)
        self.stdout.write(self.style.SUCCESS(f"Saved {len(wanted)} names."))
