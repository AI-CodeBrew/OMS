"""Remove line items the Shopify sync stored twice (see the row lock added
in integrations.services.upsert_order_from_shopify).

For every Shopify order holding an identical line item more than once,
compares OMS's items with the order's own line items on Shopify and
deletes only the surplus copies - a product Shopify itself lists on two
lines is left alone.

Usage (from backend/):
    python scripts/fix_duplicate_order_items.py <live|testing>            # dry run
    python scripts/fix_duplicate_order_items.py <live|testing> --apply    # delete
"""
import json
import sys
import urllib.error
import urllib.request
from collections import Counter
from decimal import Decimal
from pathlib import Path

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
API_VERSION = "2026-01"

DUPLICATED_ORDERS = """
select o.id, org.name, o.order_number, o.shopify_order_id, sc.shop_domain, sc.access_token
from oms.orders o
join core.organizations org on org.id = o.organization_id
left join integrations.shopify_connections sc on sc.organization_id = o.organization_id
where o.shopify_order_id is not null and o.id in (
    select order_id from oms.order_items
    group by order_id, product_name, barcode, quantity, unit_price having count(*) > 1
)
order by org.name, o.order_number
"""


def key(title, sku, quantity, price):
    return ((title or "Item")[:255], (sku or "")[:100], int(quantity or 1), Decimal(str(price or 0)).quantize(Decimal("0.01")))


def shopify_line_items(shop, token, order_id):
    req = urllib.request.Request(
        f"https://{shop}/admin/api/{API_VERSION}/orders/{order_id}.json?fields=line_items",
        headers={"X-Shopify-Access-Token": token},
    )
    return json.load(urllib.request.urlopen(req, timeout=30))["order"]["line_items"]


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("live", "testing"):
        sys.exit("Usage: python scripts/fix_duplicate_order_items.py <live|testing> [--apply]")
    profile, apply = sys.argv[1], "--apply" in sys.argv[2:]
    url = dotenv_values(ROOT / f".env.backend.{profile}")["DATABASE_URL"]

    removed_total, skipped = 0, []
    with psycopg.connect(url) as conn:
        for order_id, store, number, shopify_id, shop, token in conn.execute(DUPLICATED_ORDERS).fetchall():
            label = f"{store} | {number}"
            if not shop or not token:
                skipped.append(f"{label}: store has no Shopify connection")
                continue
            try:
                lines = shopify_line_items(shop, token, shopify_id)
            except urllib.error.HTTPError as exc:
                skipped.append(f"{label}: Shopify returned {exc.code}")
                continue
            wanted = Counter(key(li.get("title"), li.get("sku"), li.get("quantity"), li.get("price")) for li in lines)

            items = conn.execute(
                "select id, product_name, barcode, quantity, unit_price from oms.order_items "
                "where order_id = %s order by created_at desc, id desc",
                (order_id,),
            ).fetchall()
            seen, surplus = Counter(), []
            # Newest first, so the copies kept are the earliest ones.
            for item_id, name, sku, qty, price in reversed(items):
                k = key(name, sku, qty, price)
                seen[k] += 1
                if seen[k] > wanted[k] and seen[k] > 1:
                    surplus.append((item_id, name, sku))
            if not surplus:
                print(f"OK    {label}: matches Shopify, nothing to remove")
                continue
            for _, name, sku in surplus:
                print(f"{'DEL ' if apply else 'WOULD'} {label}: extra '{name}' ({sku or 'no SKU'})")
            if apply:
                conn.execute("delete from oms.order_items where id = any(%s)", ([s[0] for s in surplus],))
            removed_total += len(surplus)
        if apply:
            conn.commit()

    for line in skipped:
        print("SKIP ", line)
    print(f"\n{'Removed' if apply else 'Would remove'} {removed_total} duplicate line item(s); skipped {len(skipped)} order(s).")


if __name__ == "__main__":
    main()
