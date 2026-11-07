"use client";

import { useEffect, useState } from "react";
import Modal from "../../shared/Modal";
import Button from "../../shared/Button";
import wmsService from "../../../services/wmsService";

const STATE_LABELS = {
  received: { label: "Received", className: "bg-green-100 text-green-700" },
  partial: { label: "Partially Received", className: "bg-amber-100 text-amber-700" },
  not_received: { label: "Not Received", className: "bg-slate-100 text-slate-600" },
};

function money(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="truncate text-sm text-slate-900">{children}</div>
    </div>
  );
}

// Another delivery against a PO: for each product, how many more arrived
// good or damaged - added to what's already received, never past what was
// ordered. Good units go into the warehouse's stock. Everything the PO was
// made with is shown above, so it's checked against the delivery.
export default function ReceivePurchaseOrderModal({ po, onClose, onReceived }) {
  const [counts, setCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCounts({});
    setError("");
    setSaving(false);
  }, [po]);

  if (!po) return null;

  const num = (v) => (v === "" || v === undefined ? 0 : Number(v));
  const rows = po.lines.map((line) => {
    const c = counts[line.id] || {};
    const remaining = line.quantity_ordered - line.received;
    return { line, good: c.good ?? "", damaged: c.damaged ?? "", remaining, over: num(c.good) + num(c.damaged) > remaining };
  });
  const anything = rows.some((r) => num(r.good) + num(r.damaged) > 0);
  const canSave = anything && rows.every((r) => !r.over);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await wmsService.receivePurchaseOrder(
        po.id,
        rows
          .filter((r) => num(r.good) + num(r.damaged) > 0)
          .map((r) => ({ line: r.line.id, good: num(r.good), damaged: num(r.damaged) }))
      );
      onReceived();
    } catch (err) {
      setError(err.message || "Could not receive");
      setSaving(false);
    }
  }

  const numberInput =
    "w-20 rounded-md border border-surface-border px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand-500";

  return (
    <Modal open title={`Receive ${po.po_number}`} onClose={onClose} width="max-w-5xl">
      <div className="mb-4 rounded-md border border-surface-border bg-surface p-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Detail label="Supplier">{po.supplier_name || "—"}</Detail>
          <Detail label="Warehouse">{po.warehouse_name || "—"}</Detail>
          <Detail label="Order Date">{po.ordered_at ? new Date(po.ordered_at).toLocaleString() : "—"}</Detail>
          <Detail label="Status">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                (STATE_LABELS[po.state] || STATE_LABELS.not_received).className
              }`}
            >
              {(STATE_LABELS[po.state] || STATE_LABELS.not_received).label}
            </span>
          </Detail>
          <Detail label="Products">{po.product_count ?? po.lines.length}</Detail>
          <Detail label="Total Qty">{po.total_quantity ?? "—"}</Detail>
          <Detail label="Received Qty">
            {po.received_quantity ?? 0}
            {po.damaged_quantity ? <span className="text-red-600"> ({po.damaged_quantity} dmg)</span> : null}
          </Detail>
          <Detail label="Total Cost">PKR {money(po.total_cost)}</Detail>
        </div>
        {po.note ? (
          <div className="mt-3 border-t border-surface-border pt-2 text-sm text-slate-700">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Note </span>
            {po.note}
          </div>
        ) : null}
      </div>
      <p className="mb-2 text-sm text-slate-500">Enter what arrived in this delivery.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-surface-border text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3 text-left">Product</th>
              <th className="px-2 py-2 text-right">Price</th>
              <th className="px-2 py-2 text-right">Ordered</th>
              <th className="px-2 py-2 text-right">Line Total</th>
              <th className="px-2 py-2 text-right">Received</th>
              <th className="px-2 py-2 text-right">Left</th>
              <th className="px-2 py-2 text-right">Good</th>
              <th className="py-2 pl-2 text-right">Damaged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, good, damaged, remaining, over }) => (
              <tr key={line.id} className="border-b border-surface-border last:border-0">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    {line.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={line.image_url} alt="" className="h-9 w-9 shrink-0 rounded border border-surface-border object-cover" />
                    ) : null}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{line.sku}</div>
                      <div className="max-w-[200px] truncate text-xs text-slate-500" title={line.product_name}>
                        {line.product_name}
                      </div>
                    </div>
                  </div>
                  {over ? <div className="text-[11px] text-red-600">Only {remaining} left to receive</div> : null}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{money(line.unit_price)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{line.quantity_ordered}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {money((Number(line.unit_price) || 0) * (line.quantity_ordered || 0))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                  {line.received}
                  {line.damaged_received ? <span className="text-red-600"> ({line.damaged_received} dmg)</span> : null}
                </td>
                <td className={`px-2 py-2 text-right tabular-nums ${remaining > 0 ? "font-medium text-slate-900" : "text-slate-400"}`}>
                  {Math.max(remaining, 0)}
                </td>
                {[
                  ["good", good],
                  ["damaged", damaged],
                ].map(([field, value]) => (
                  <td key={field} className="px-2 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      disabled={remaining <= 0}
                      value={value}
                      placeholder="0"
                      onChange={(e) =>
                        setCounts((prev) => ({ ...prev, [line.id]: { ...prev[line.id], [field]: e.target.value } }))
                      }
                      className={numberInput}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={saving} disabled={!canSave} onClick={save}>
          Receive
        </Button>
      </div>
    </Modal>
  );
}
