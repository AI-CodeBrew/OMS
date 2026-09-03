"use client";

import Modal from "../shared/Modal";
import Button from "../shared/Button";

function WarningIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 3.5 2.5 16.5h15L10 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.75" fill="currentColor" />
    </svg>
  );
}

/**
 * Shown when Ready to Print is blocked by insufficient warehouse stock.
 * `shortfalls` is the structured payload the bulk-action endpoint returns
 * (error_code "insufficient_stock"), so the operator sees exactly which
 * SKUs are short by how much before deciding to push through anyway.
 */
export default function StockShortageModal({ shortfalls, onProceed, onClose, submitting }) {
  if (!shortfalls || shortfalls.length === 0) return null;

  return (
    <Modal open title="Not enough stock" onClose={onClose} width="max-w-2xl">
      <div className="flex items-start gap-3 rounded-md bg-amber-50 p-3">
        <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800">
          {shortfalls.length === 1
            ? "This order needs more units than the warehouse has on hand."
            : `${shortfalls.length} orders need more units than the warehouse has on hand.`}{" "}
          You can still process them — the shortfall will show as negative stock on the WMS screen.
        </p>
      </div>

      <div className="mt-4 max-h-64 overflow-y-auto rounded-md border border-surface-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Need</th>
              <th className="px-3 py-2 text-right">Have</th>
              <th className="px-3 py-2 text-right">Short</th>
            </tr>
          </thead>
          <tbody>
            {shortfalls.flatMap((row) =>
              (row.shortages || []).map((s, i) => (
                <tr key={`${row.order_id}-${s.sku}-${i}`} className="border-t border-surface-border">
                  <td className="px-3 py-2 font-medium text-slate-800">{row.order_number || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {s.product_name || s.sku}
                    {s.sku ? <span className="ml-1 text-xs text-slate-400">({s.sku})</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{s.required}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{s.available}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-600">
                    −{s.short_by}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={onProceed} loading={submitting}>
          Process anyway
        </Button>
      </div>
    </Modal>
  );
}
