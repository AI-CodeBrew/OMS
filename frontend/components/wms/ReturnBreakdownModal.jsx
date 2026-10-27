"use client";

import { useEffect, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";

// The returns desk's count for one parcel: every line of the order with how
// many units came back good, damaged or lost/missing. Each line starts all
// Good; Damaged and Lost are entered and Good is what's left, so a line
// always adds up to its quantity. Only good units go back into stock
// (backend: wms.services.restock_from_return).
//
// `request` is { orderNumber, lines: [{key, sku, product_name, quantity}] }
// from the return lookup; null keeps the modal closed.
export default function ReturnBreakdownModal({ request, onConfirm, onClose }) {
  const [counts, setCounts] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!request) return;
    setCounts(Object.fromEntries(request.lines.map((l) => [l.key, { damaged: 0, lost: 0 }])));
    setSaving(false);
  }, [request]);

  if (!request) return null;

  function setCount(line, field, raw) {
    const other = field === "damaged" ? "lost" : "damaged";
    setCounts((prev) => {
      const current = prev[line.key] || { damaged: 0, lost: 0 };
      // Never more damaged + lost than the line has units.
      const max = line.quantity - (current[other] || 0);
      const value = Math.min(Math.max(parseInt(raw, 10) || 0, 0), max);
      return { ...prev, [line.key]: { ...current, [field]: value } };
    });
  }

  const rows = request.lines.map((line) => {
    const c = counts[line.key] || { damaged: 0, lost: 0 };
    return { ...line, damaged: c.damaged, lost: c.lost, good: line.quantity - c.damaged - c.lost };
  });
  const totals = rows.reduce(
    (t, r) => ({ good: t.good + r.good, damaged: t.damaged + r.damaged, lost: t.lost + r.lost }),
    { good: 0, damaged: 0, lost: 0 }
  );

  async function confirm() {
    setSaving(true);
    try {
      await onConfirm(rows.map(({ key, good, damaged, lost }) => ({ key, good, damaged, lost })));
    } finally {
      setSaving(false);
    }
  }

  const input =
    "w-16 rounded-md border border-surface-border px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand-500";

  return (
    <Modal open title={`Receive return ${request.orderNumber}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        Every unit starts as Good. Enter any damaged or lost/missing units - only good units go back into stock.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-surface-border text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3 text-left">SKU</th>
              <th className="px-2 py-2 text-right">Quantity</th>
              <th className="px-2 py-2 text-right">Good</th>
              <th className="px-2 py-2 text-right">Damaged</th>
              <th className="py-2 pl-2 text-right">Lost/Missing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-surface-border last:border-0">
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-800">{row.sku || "—"}</div>
                  <div className="max-w-[220px] truncate text-xs text-slate-500" title={row.product_name}>
                    {row.product_name}
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{row.quantity}</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums text-green-700">{row.good}</td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    max={row.quantity}
                    value={row.damaged}
                    onChange={(e) => setCount(row, "damaged", e.target.value)}
                    className={input}
                    aria-label={`Damaged ${row.sku || row.product_name}`}
                  />
                </td>
                <td className="py-2 pl-2 text-right">
                  <input
                    type="number"
                    min={0}
                    max={row.quantity}
                    value={row.lost}
                    onChange={(e) => setCount(row, "lost", e.target.value)}
                    className={input}
                    aria-label={`Lost ${row.sku || row.product_name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        <span className="text-green-700">{totals.good} good</span> ·{" "}
        <span className="text-red-700">{totals.damaged} damaged</span> ·{" "}
        <span className="text-amber-700">{totals.lost} lost/missing</span>
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={saving} onClick={confirm}>
          Confirm Receive
        </Button>
      </div>
    </Modal>
  );
}
