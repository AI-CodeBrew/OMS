"""One purchase order as a printable PDF - the PO popup's Download PO.
FynkTech's name at the top, the store it's for, everything the PO was made
with (supplier, warehouse, date, status, note), its products and costs
(products + logistics = total). Rendered with the same Playwright HTML ->
PDF worker the BarqRaftar load sheet uses."""

from decimal import Decimal
from html import escape
from zoneinfo import ZoneInfo

from django.utils.dateparse import parse_datetime

PKT = ZoneInfo("Asia/Karachi")
STATE_LABELS = {"received": "Received", "partial": "Partially Received", "not_received": "Not Received"}


def _money(value):
    return f"{Decimal(str(value or 0)):,.2f}"


def _date(value):
    if not value:
        return "-"
    when = parse_datetime(value) if isinstance(value, str) else value
    return when.astimezone(PKT).strftime("%d/%m/%Y, %I:%M %p") if when else "-"


def po_html(data, store_name):
    """`data`: PurchaseOrderSerializer output."""
    rows = []
    for line in data.get("lines") or []:
        price = Decimal(str(line.get("unit_price") or 0))
        qty = int(line.get("quantity_ordered") or 0)
        left = max(qty - int(line.get("received") or 0), 0)
        rows.append(
            "<tr>"
            f"<td>{escape(line.get('sku') or '-')}</td>"
            f"<td>{escape(line.get('product_name') or '')}</td>"
            f"<td class='n'>{_money(price)}</td>"
            f"<td class='n'>{qty}</td>"
            f"<td class='n'>{_money(price * qty)}</td>"
            f"<td class='n'>{int(line.get('good_received') or 0)}</td>"
            f"<td class='n'>{int(line.get('damaged_received') or 0)}</td>"
            f"<td class='n'>{left}</td>"
            "</tr>"
        )
    note = (
        f"<div class='note'><span class='label'>Note</span> {escape(data.get('note') or '')}</div>"
        if data.get("note") else ""
    )
    state = STATE_LABELS.get(data.get("state"), data.get("state") or "")
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{escape(data.get('po_number') or 'Purchase Order')}</title>
<style>
  @page {{ size: A4; margin: 16mm 14mm; }}
  body {{ font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 12px; }}
  .top {{ display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 3px solid #1e1b4b; padding-bottom: 10px; margin-bottom: 14px; }}
  .brand {{ font-size: 24px; font-weight: 800; color: #1e1b4b; letter-spacing: .5px; }}
  .brand small {{ display: block; font-size: 11px; font-weight: 500; color: #64748b; letter-spacing: 0; }}
  .doc {{ text-align: right; }}
  .doc .title {{ font-size: 16px; font-weight: 700; }}
  .doc .po {{ font-size: 18px; font-weight: 800; color: #4338ca; }}
  .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }}
  .box {{ border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 9px; }}
  .label {{ display: block; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: .4px; }}
  .val {{ font-size: 12px; font-weight: 600; margin-top: 2px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 4px; }}
  th {{ background: #f1f5f9; font-size: 9px; text-transform: uppercase; color: #475569; text-align: left; padding: 7px 6px; border: 1px solid #e2e8f0; }}
  td {{ padding: 6px; border: 1px solid #e2e8f0; vertical-align: top; }}
  .n {{ text-align: right; white-space: nowrap; }}
  .totals {{ margin-top: 12px; margin-left: auto; width: 46%; }}
  .totals td {{ border: none; border-bottom: 1px solid #e2e8f0; padding: 6px 4px; }}
  .totals tr:last-child td {{ font-weight: 800; font-size: 14px; border-bottom: 2px solid #1e1b4b; }}
  .note {{ margin-top: 12px; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; }}
  .foot {{ margin-top: 28px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; }}
  .sign {{ border-top: 1px solid #94a3b8; width: 180px; text-align: center; padding-top: 4px; }}
</style></head>
<body>
  <div class="top">
    <div class="brand">FynkTech<small>Purchase Order for {escape(store_name or '')}</small></div>
    <div class="doc"><div class="title">Purchase Order</div><div class="po">{escape(data.get('po_number') or '')}</div></div>
  </div>
  <div class="grid">
    <div class="box"><span class="label">Store</span><div class="val">{escape(store_name or '-')}</div></div>
    <div class="box"><span class="label">Supplier</span><div class="val">{escape(data.get('supplier_name') or '-')}</div></div>
    <div class="box"><span class="label">Warehouse</span><div class="val">{escape(data.get('warehouse_name') or '-')}</div></div>
    <div class="box"><span class="label">Order Date</span><div class="val">{_date(data.get('ordered_at'))}</div></div>
    <div class="box"><span class="label">Status</span><div class="val">{escape(state)}</div></div>
    <div class="box"><span class="label">Products</span><div class="val">{data.get('product_count') or 0}</div></div>
    <div class="box"><span class="label">Total Qty</span><div class="val">{data.get('total_quantity') or 0}</div></div>
    <div class="box"><span class="label">Received Qty</span><div class="val">{data.get('received_quantity') or 0}</div></div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th>Product</th><th class="n">Product Cost</th><th class="n">Ordered</th>
      <th class="n">Line Total</th><th class="n">Good</th><th class="n">Damaged</th><th class="n">Left</th></tr></thead>
    <tbody>{''.join(rows) or "<tr><td colspan='8'>No products</td></tr>"}</tbody>
  </table>
  <table class="totals">
    <tr><td>Products Cost</td><td class="n">PKR {_money(data.get('products_cost'))}</td></tr>
    <tr><td>Logistics Cost</td><td class="n">PKR {_money(data.get('logistics_cost'))}</td></tr>
    <tr><td>Total Cost</td><td class="n">PKR {_money(data.get('total_cost'))}</td></tr>
  </table>
  {note}
  <div class="foot">
    <div>Generated by FynkTech OMS</div>
    <div class="sign">Authorised Signature</div>
  </div>
</body></html>"""
