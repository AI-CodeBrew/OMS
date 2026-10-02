"""Our own BarqRaftar "Goods Load Sheet" - the list of parcels handed over to
BarqRaftar's pickup rider, with signature boxes.

BarqRaftar's API has no load sheet (checked against every section of their
API docs and their Postman collection - only shipping labels); their own
sheet only exists behind a portal login (barqraftar.pk/members/reports/
loadsheet_orders/<id>, 302 -> /login without a session, 401 with our API
key). So this rebuilds the same layout ourselves, from BarqRaftar's own
order data (get_multiple_orders) so consignment numbers, pieces and COD
amounts match what their portal would print.
"""

import html
import json
import logging
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import client
from .exceptions import BarqRaftarAPIError

logger = logging.getLogger(__name__)

_PKT = ZoneInfo("Asia/Karachi")


def _money(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _int(value, default=1):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def build_rows(connection, shipments):
    """One row per shipment, in booking order. Values come from BarqRaftar's
    own record of each consignment where it has one (so the sheet matches
    their portal's), falling back to our local order data only for a
    consignment their API didn't return. Returns (rows, shipper_name)."""
    tracking_numbers = [s.tracking_number for s in shipments]
    remote = {}
    for start in range(0, len(tracking_numbers), 50):
        chunk = tracking_numbers[start:start + 50]
        for row in client.get_multiple_orders(connection.api_key, connection.api_secret, chunk, per_page=50):
            if isinstance(row, dict) and row.get("number"):
                remote[str(row["number"])] = row

    rows = []
    shipper_name = ""
    for shipment in shipments:
        order = shipment.order
        data = remote.get(shipment.tracking_number)
        if data:
            shipper_name = shipper_name or str(data.get("shipper_name") or "")
            rows.append({
                "consignment": shipment.tracking_number,
                "consignee": str(data.get("customer_name") or order.customer_name or ""),
                "reference": str(data.get("customer_reference") or shipment.reference_id),
                "destination": str((data.get("to_city") or {}).get("name") or order.city or ""),
                "pieces": _int(data.get("pieces")),
                "cod": _money(data.get("cod_amount")),
            })
        else:
            logger.warning("barqraftar load sheet: %s not returned by BarqRaftar, using local data",
                           shipment.tracking_number)
            rows.append({
                "consignment": shipment.tracking_number,
                "consignee": order.customer_name or "",
                "reference": shipment.reference_id,
                "destination": order.city or "",
                "pieces": max(order.items.count(), 1),
                "cod": float(order.amount_receivable) if order.payment_gateway == "cod" else 0.0,
            })
    return rows, shipper_name


def _fmt_total(amount):
    return f"{amount:.0f}" if float(amount).is_integer() else f"{amount:.2f}"


def build_html(*, customer_name, account_number, rows, generated_at=None):
    """Same layout as BarqRaftar's own portal "GOODS LOAD SHEET" (title, the
    customer/account/date block, the 7-column table with a Total row, the
    disclaimer, and the customer / pick-up staff signature table). The one
    deliberate difference: the small heading above the title says the sheet
    was generated from OMS, rather than claiming to be BarqRaftar's portal."""
    generated_at = (generated_at or datetime.now(_PKT)).astimezone(_PKT)
    stamp = generated_at.strftime("%m/%d/%Y %I:%M:%S ") + generated_at.strftime("%p").lower()
    esc = html.escape
    customer = esc(customer_name or "")

    body_rows = "".join(
        f"<tr><td>{i}</td><td>{esc(r['consignment'])}</td><td>{esc(r['consignee'])}</td>"
        f"<td>{esc(r['reference'])}</td><td>{esc(r['destination'])}</td>"
        f"<td>{r['pieces']}</td><td>{r['cod']:.2f}</td></tr>"
        for i, r in enumerate(rows, start=1)
    )
    total_pieces = sum(r["pieces"] for r in rows)
    total_cod = sum(r["cod"] for r in rows)

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Goods Load Sheet</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: "Segoe UI", Arial, sans-serif; color: #111; margin: 0; font-size: 13px; }}
  .portal {{ text-align: center; font-size: 13px; margin: 0 0 14px; }}
  h1 {{ text-align: center; font-size: 24px; font-weight: 600; margin: 0 0 18px; letter-spacing: .5px; }}
  .info {{ margin: 0 0 14px 26px; line-height: 1.6; }}
  .info b {{ font-weight: 700; }}
  table {{ width: 100%; border-collapse: collapse; }}
  .sheet th, .sheet td {{ border: 1px solid #000; padding: 5px 6px; text-align: center; }}
  .sheet th {{ font-weight: 700; }}
  .sheet tr {{ page-break-inside: avoid; }}
  .sheet .total td {{ font-size: 20px; font-weight: 700; padding: 6px; }}
  .sheet .total .label {{ text-align: right; }}
  h2 {{ font-size: 18px; font-weight: 600; margin: 12px 0 6px; }}
  .disclaimer p {{ margin: 0 0 4px; }}
  .sign {{ width: 68%; margin-top: 14px; page-break-inside: avoid; }}
  .sign td {{ border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: middle; }}
</style></head>
<body>
  <p class="portal">Generated from OMS</p>
  <h1>GOODS LOAD SHEET</h1>
  <div class="info">
    <div><b>Customer Name:</b> {customer}</div>
    <div><b>Barqraftar Express Account #:</b> {esc(account_number or "")}</div>
    <div><b>Booking Date:</b> {stamp}</div>
    <div><b>Report Run Time:</b> {stamp}</div>
    <div><b>Following Goods / Shipments have been received.</b></div>
  </div>
  <table class="sheet">
    <thead><tr>
      <th>Sr. #</th><th>Consignment#</th><th>Consignee Name#</th><th>Cust. Ref. #</th>
      <th>Destination</th><th>Pieces</th><th>COD Amount</th>
    </tr></thead>
    <tbody>
      {body_rows}
      <tr class="total"><td class="label" colspan="5">Total:</td><td>{total_pieces}</td><td>{_fmt_total(total_cod)}</td></tr>
    </tbody>
  </table>
  <h2>Disclaimer</h2>
  <div class="disclaimer">
    <p><b>{customer}</b> is to ensure that the items being handed over to Barqraftar Express Logistic's pick-up staff are pasted with right address label</p>
    <p><b>{customer}</b> will be responsible for the content packed inside the shipment.</p>
    <p><b>{customer}</b> will ensure the availability with the required COD amount for hassle free delivery.</p>
    <p>Booked weight may vary with invoice / billing weight as our manifested weight will be treated as final weight.</p>
  </div>
  <table class="sign">
    <tr><td style="width:28%">Customer</td><td colspan="2">Barqraftar Express Logistic's PICK-UP STAFF</td></tr>
    <tr><td rowspan="2">Name</td><td style="width:30%">Name</td><td rowspan="2"></td></tr>
    <tr><td>Courier</td></tr>
    <tr><td rowspan="2">Sign and Stamp</td><td>Signature</td><td rowspan="2"></td></tr>
    <tr><td>Date &amp; Time</td></tr>
  </table>
</body></html>"""


def render_pdf(html_doc, *, context="load sheet"):
    """HTML -> PDF through barqraftar/pdf_worker.py in a subprocess (see that
    file for why it can't run in-process under Daphne on Windows)."""
    started = time.monotonic()
    worker = Path(__file__).with_name("pdf_worker.py")
    payload = json.dumps({"html": html_doc, "context": context}).encode("utf-8")
    try:
        result = subprocess.run(
            [sys.executable, str(worker)], input=payload, capture_output=True, timeout=60,
        )
    except subprocess.TimeoutExpired as exc:
        raise BarqRaftarAPIError(f"Could not render the BarqRaftar {context} as PDF: timed out") from exc

    stderr = (result.stderr or b"").decode("utf-8", errors="replace").strip()
    for line in stderr.splitlines():
        logger.info("barqraftar pdf worker: %s", line)

    if result.returncode != 0:
        if "Executable doesn't exist" in stderr:
            raise BarqRaftarAPIError(
                f"Could not render the BarqRaftar {context} as PDF: the server is missing its "
                "Chromium browser ('playwright install chromium' must run at deploy)."
            )
        raise BarqRaftarAPIError(f"Could not render the BarqRaftar {context} as PDF: {stderr or 'unknown error'}")

    logger.info("barqraftar %s rendered: %s bytes in %.2fs", context, len(result.stdout), time.monotonic() - started)
    return result.stdout
