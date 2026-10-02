"""Printable invoice HTML - same convention as oms.views._print_document_html
(a plain styled page with a Print button, opened in a new tab; the browser's
own "Save as PDF" is the export path, no server-side PDF rendering needed
for something this simple)."""


def invoice_print_html(invoice):
    lines_rows = "".join(
        f"<tr><td>{line.description}</td><td>{line.quantity}</td>"
        f"<td>{line.unit_price}</td><td>{line.amount}</td></tr>"
        for line in invoice.lines.all()
    ) or "<tr><td colspan='4'>No line items</td></tr>"

    status_label = invoice.get_status_display()
    period = (
        f"{invoice.period_start} to {invoice.period_end}"
        if invoice.period_start and invoice.period_end
        else "—"
    )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice {invoice.number or 'Draft'}</title>
<style>
  body {{ font-family: Arial, sans-serif; color: #0f172a; padding: 40px; max-width: 720px; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }}
  .sub {{ color: #64748b; font-size: 13px; margin-bottom: 24px; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; font-size: 13px; }}
  .label {{ color: #64748b; font-size: 11px; text-transform: uppercase; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
  th, td {{ text-align: left; padding: 8px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }}
  th {{ color: #64748b; font-size: 11px; text-transform: uppercase; }}
  td:nth-child(n+2), th:nth-child(n+2) {{ text-align: right; }}
  .totals {{ margin-top: 12px; display: flex; justify-content: flex-end; }}
  .totals table {{ width: 260px; }}
  .totals td {{ border-bottom: none; padding: 4px 6px; }}
  .totals .total-row td {{ font-weight: bold; font-size: 15px; border-top: 1px solid #0f172a; }}
  .status {{ display: inline-block; padding: 2px 10px; border-radius: 999px; background: #f1f5f9; font-size: 12px; font-weight: 600; }}
  .notes {{ margin-top: 24px; font-size: 13px; color: #334155; white-space: pre-wrap; }}
  .print-btn {{ margin-top: 32px; padding: 8px 16px; }}
  @media print {{ .print-btn {{ display: none; }} }}
</style></head>
<body>
  <h1>FynkTech - Dispatch Invoice</h1>
  <p class="sub">{invoice.number or "Draft"} &middot; <span class="status">{status_label}</span></p>
  <div class="grid">
    <div><div class="label">Billed to</div>{invoice.organization.name}</div>
    <div><div class="label">Period</div>{period}</div>
    <div><div class="label">Issued</div>{invoice.issued_at.date() if invoice.issued_at else "—"}</div>
    <div><div class="label">Due</div>{invoice.due_date or "—"}</div>
  </div>
  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>{lines_rows}</tbody>
  </table>
  <div class="totals">
    <table>
      <tr><td>Subtotal</td><td>Rs {invoice.subtotal}</td></tr>
      <tr class="total-row"><td>Total</td><td>Rs {invoice.total}</td></tr>
    </table>
  </div>
  {f'<div class="notes">{invoice.notes}</div>' if invoice.notes else ""}
  <button class="print-btn" onclick="window.print()">Print</button>
</body></html>"""
