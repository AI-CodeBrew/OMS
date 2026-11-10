"use client";

import { useState } from "react";
import Modal from "../../shared/Modal";
import Button from "../../shared/Button";
import wmsService from "../../../services/wmsService";

import { formatDateTime } from "../../../lib/formatDate";
export const PO_STATE_LABELS = {
  received: { label: "Received", className: "bg-green-100 text-green-700" },
  partial: { label: "Partially Received", className: "bg-amber-100 text-amber-700" },
  not_received: { label: "Not Received", className: "bg-slate-100 text-slate-600" },
};

export function money(value) {
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

/** Everything a PO was made with - supplier, warehouse, date, status,
 * quantities and costs (products + logistics = total), and its note. Shared
 * by the PO popup and the Receive popup. */
export function PurchaseOrderSummary({ po }) {
  const state = PO_STATE_LABELS[po.state] || PO_STATE_LABELS.not_received;
  return (
    <div className="rounded-md border border-surface-border bg-surface p-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Detail label="Supplier">{po.supplier_name || "—"}</Detail>
        <Detail label="Warehouse">{po.warehouse_name || "—"}</Detail>
        <Detail label="Order Date">{po.ordered_at ? formatDateTime(po.ordered_at) : "—"}</Detail>
        <Detail label="Status">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state.className}`}>{state.label}</span>
        </Detail>
        <Detail label="Products">{po.product_count ?? po.lines.length}</Detail>
        <Detail label="Total Qty">{po.total_quantity ?? "—"}</Detail>
        <Detail label="Received Qty">
          {po.received_quantity ?? 0}
          {po.damaged_quantity ? <span className="text-red-600"> ({po.damaged_quantity} dmg)</span> : null}
        </Detail>
        <Detail label="Products Cost">PKR {money(po.products_cost ?? po.total_cost)}</Detail>
        <Detail label="Logistics Cost">PKR {money(po.logistics_cost)}</Detail>
        <Detail label="Total Cost">
          <span className="font-semibold">PKR {money(po.total_cost)}</span>
        </Detail>
      </div>
      {po.note ? (
        <div className="mt-3 border-t border-surface-border pt-2 text-sm text-slate-700">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Note </span>
          {po.note}
        </div>
      ) : null}
    </div>
  );
}

// A PO opened from the Purchase Orders list (its number): all its details
// and products, read only - Receive from here when there's more to come.
export default function PurchaseOrderDetailModal({ po, onClose, onReceive }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  if (!po) return null;

  // This PO as a PDF - FynkTech + store name, details, products and costs.
  async function download() {
    setDownloading(true);
    setError("");
    try {
      await wmsService.downloadPurchaseOrderPdf(po.id, `${po.po_number}.pdf`);
    } catch (err) {
      setError(err.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal
      open
      title={po.po_number}
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" loading={downloading} onClick={download}>
            Download PO
          </Button>
          {onReceive && po.state !== "received" ? <Button onClick={() => onReceive(po)}>Receive</Button> : null}
        </>
      }
    >
      {error ? <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <PurchaseOrderSummary po={po} />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-surface-border text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3 text-left">Product</th>
              <th className="px-2 py-2 text-right">Product Cost</th>
              <th className="px-2 py-2 text-right">Ordered</th>
              <th className="px-2 py-2 text-right">Line Total</th>
              <th className="px-2 py-2 text-right">Good</th>
              <th className="px-2 py-2 text-right">Damaged</th>
              <th className="py-2 pl-2 text-right">Left</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((line) => {
              const left = Math.max(line.quantity_ordered - line.received, 0);
              return (
                <tr key={line.id} className="border-b border-surface-border last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      {line.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={line.image_url} alt="" className="h-9 w-9 shrink-0 rounded border border-surface-border object-cover" />
                      ) : null}
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800">{line.sku}</div>
                        <div className="max-w-[240px] truncate text-xs text-slate-500" title={line.product_name}>
                          {line.product_name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(line.unit_price)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{line.quantity_ordered}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {money((Number(line.unit_price) || 0) * (line.quantity_ordered || 0))}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-green-700">{line.good_received}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-red-700">{line.damaged_received}</td>
                  <td className={`py-2 pl-2 text-right tabular-nums ${left > 0 ? "font-medium text-slate-900" : "text-slate-400"}`}>
                    {left}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
