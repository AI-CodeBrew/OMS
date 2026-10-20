"""Export every order, with its line items and store name, to a JSON file.

Usage (from backend/):
    python scripts/export_orders_json.py live    C:/path/orders.json
    python scripts/export_orders_json.py testing C:/path/orders.json

Reads the DATABASE_URL from .env.backend.<profile> and only ever reads -
the session is set read-only. The output holds customer names, phones and
addresses, so keep it out of the repo and share it privately.
"""
import json
import sys
from pathlib import Path

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent

QUERY = """
select coalesce(json_agg(row_to_json(o) order by o.created_at), '[]'::json)
from (
    select org.name as store_name,
           ord.*,
           coalesce((
               select json_agg(row_to_json(item) order by item.id)
               from oms.order_items item
               where item.order_id = ord.id
           ), '[]'::json) as items
    from oms.orders ord
    join core.organizations org on org.id = ord.organization_id
) o
"""


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("live", "testing"):
        sys.exit("Usage: python scripts/export_orders_json.py <live|testing> <output.json>")
    profile, out = sys.argv[1], Path(sys.argv[2])

    url = dotenv_values(ROOT / f".env.backend.{profile}").get("DATABASE_URL")
    if not url:
        sys.exit(f"DATABASE_URL missing from .env.backend.{profile}")

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("set default_transaction_read_only = on")
        orders = conn.execute(QUERY).fetchone()[0]

    out.write_text(json.dumps(orders, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    items = sum(len(o["items"]) for o in orders)
    print(f"Wrote {len(orders)} orders ({items} line items) from {profile} to {out}")


if __name__ == "__main__":
    main()
