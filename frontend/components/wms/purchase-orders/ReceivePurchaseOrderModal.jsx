"use client";

import { useEffect, useState } from "react";
import Modal from "../../shared/Modal";
import Button from "../../shared/Button";
import wmsService from "../../../services/wmsService";
import { PurchaseOrderSummary, money } from "./PurchaseOrderDetailModal";

// Another delivery against a PO: for each product, how many more arrived
// good or damaged - added to what's already received, never past what was
// ordered. Good units go into the warehouse's stock. Everything the PO was
// made with is shown above, so it's checked against the delivery.
// The Logistics Cost and each product's cost can be corrected here too -
// saved with the delivery, or on their own (Save Costs).
export default function ReceivePurchaseOrderModal({ po, onClose, onReceived }) {
  const [counts, setCounts] = useState({});
  // Edited costs: logistics (string) and {lineId: price string}.
  const [logistics, setLogistics] = useState("");
  const [prices, setPrices] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCounts({});
    setLogistics(po ? String(po.logistics_cost ?? "0") : "");
    setPrices(po ? Object.fromEntries(po.lines.map((l) => [l.id, String(l.unit_price ?? "0")])) : {});
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
  const priceOf = (line) => (prices[line.id] === undefined ? Number(line.unit_price) || 0 : num(prices[line.id]));
  const changedPrices = Object.fromEntries(
    po.lines
      .filter((l) => prices[l.id] !== undefined && num(prices[l.id]) !== (Number(l.unit_price) || 0))
      .map((l) => [l.id, prices[l.id]])
  );
  const logisticsChanged = logistics !== "" && num(logistics) !== (Number(po.logistics_cost) || 0);
  const costsChanged = logisticsChanged || Object.keys(changedPrices).length > 0;
  const badCost = num(logistics) < 0 || Object.values(prices).some((v) => num(v) < 0);
  const canSave = (anything || costsChanged) && rows.every((r) => !r.over) && !badCost;
  const productsCost = po.lines.reduce((sum, l) => sum + priceOf(l) * (l.quantity_ordered || 0), 0);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await wmsService.receivePurchaseOrder(
        po.id,
        rows
          .filter((r) => num(r.good) + num(r.damaged) > 0)
          .map((r) => ({ line: r.line.id, good: num(r.good), damaged: num(r.damaged) })),
        {
          logisticsCost: logisticsChanged ? logistics : undefined,
          unitPrices: Object.keys(changedPrices).length ? changedPrices : undefined,
        }
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
      <div className="mb-4">
        <PurchaseOrderSummary po={po} />
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-4 rounded-md border border-surface-border bg-surface/60 px-3 py-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Logistics Cost (PKR)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={logistics}
            onChange={(e) => setLogistics(e.target.value)}
            className="w-36 rounded-md border border-surface-border bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand-500"
          />
        </label>
        <div className="text-sm text-slate-600">
          Products Cost: <span className="font-semibold tabular-nums">PKR {money(productsCost)}</span>
          <span className="mx-2 text-slate-300">|</span>
          Total Cost: <span className="font-semibold tabular-nums">PKR {money(productsCost + num(logistics))}</span>
        </div>
        <div className="text-[11px] text-slate-400">Product Cost and Logistics Cost can be corrected here.</div>
      </div>
      <p className="mb-2 text-sm text-slate-500">Enter what arrived in this delivery.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-surface-border text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3 text-left">Product</th>
              <th className="px-2 py-2 text-right">Product Cost</th>
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
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={prices[line.id] ?? ""}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    className="w-24 rounded-md border border-surface-border px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand-500"
                  />
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{line.quantity_ordered}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {money(priceOf(line) * (line.quantity_ordered || 0))}
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
          {anything ? "Receive" : "Save Costs"}
        </Button>
      </div>
    </Modal>
  );
}
