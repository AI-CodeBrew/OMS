"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "../../shared/Modal";
import Button from "../../shared/Button";
import wmsService from "../../../services/wmsService";

// The local date and time, as a datetime-local input wants it.
function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function emptyLine() {
  return {
    id: Math.random().toString(36).slice(2),
    sku: "",
    product_name: "",
    image_url: "",
    quantity_ordered: "",
    unit_price: "",
    good: "",
    damaged: "",
    lookup: "idle", // idle | loading | found | missing
  };
}

// Add PO: supplier, receiving warehouse and date (filled with now), then
// one row per product - typing a SKU fills in its name and Shopify image
// (synced by Sync from Shopify). Good / Damaged are what has already
// arrived; good units go straight into the warehouse's stock.
export default function AddPurchaseOrderModal({ open, suppliers, warehouses, onClose, onCreated }) {
  const [supplier, setSupplier] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [orderedAt, setOrderedAt] = useState(nowLocal);
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const timers = useRef({});

  useEffect(() => {
    if (!open) return;
    setSupplier("");
    setWarehouse((warehouses.find((w) => w.is_default) || warehouses[0])?.id || "");
    setOrderedAt(nowLocal());
    setLines([emptyLine()]);
    setError("");
    setSaving(false);
  }, [open, warehouses]);

  if (!open) return null;

  function update(id, patch) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function onSkuChange(line, sku) {
    update(line.id, { sku, lookup: sku.trim() ? "loading" : "idle" });
    clearTimeout(timers.current[line.id]);
    if (!sku.trim()) return;
    // Looked up once typing (or a scanner) pauses.
    timers.current[line.id] = setTimeout(async () => {
      try {
        const product = await wmsService.purchaseOrderProduct(sku.trim());
        setLines((prev) =>
          prev.map((l) =>
            l.id !== line.id || l.sku !== sku
              ? l
              : product
                ? { ...l, product_name: product.product_name, image_url: product.image_url, lookup: "found" }
                : { ...l, image_url: "", lookup: "missing" }
          )
        );
      } catch {
        update(line.id, { lookup: "missing" });
      }
    }, 400);
  }

  const num = (v) => (v === "" ? 0 : Number(v));
  const lineProblem = (l) => {
    if (!l.sku.trim()) return "SKU is required";
    if (!(num(l.quantity_ordered) > 0)) return "Quantity ordered must be more than 0";
    if (num(l.good) + num(l.damaged) > num(l.quantity_ordered)) return "Good + Damaged is more than ordered";
    return "";
  };
  const problems = lines.map(lineProblem);
  const canSave = supplier && warehouse && lines.length > 0 && problems.every((p) => !p);
  const totalCost = lines.reduce((sum, l) => sum + num(l.quantity_ordered) * num(l.unit_price), 0);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await wmsService.createPurchaseOrder({
        supplier,
        warehouse,
        ordered_at: orderedAt ? new Date(orderedAt).toISOString() : undefined,
        lines: lines.map((l) => ({
          sku: l.sku.trim(),
          product_name: l.product_name.trim(),
          image_url: l.image_url,
          quantity_ordered: num(l.quantity_ordered),
          unit_price: num(l.unit_price),
          good: num(l.good),
          damaged: num(l.damaged),
        })),
      });
      onCreated();
    } catch (err) {
      setError(err.message || "Could not save the PO");
      setSaving(false);
    }
  }

  const input =
    "w-full rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500";
  const numberInput = `${input} text-right tabular-nums`;

  return (
    <Modal open title="Add Purchase Order" onClose={onClose} width="max-w-6xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            Supplier<span className="text-red-600"> *</span>
          </span>
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={input}>
            <option value="">{suppliers.length ? "Select a supplier…" : "Add a supplier first"}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.city ? ` (${s.city})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            Receiving warehouse<span className="text-red-600"> *</span>
          </span>
          <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className={input}>
            <option value="">{warehouses.length ? "Select a warehouse…" : "Add a warehouse first"}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.city ? ` (${w.city})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Date &amp; time</span>
          <input
            type="datetime-local"
            value={orderedAt}
            onChange={(e) => setOrderedAt(e.target.value)}
            className={input}
          />
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-surface-border text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-14 py-2 pr-2 text-left">Image</th>
              <th className="w-40 px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">Product name</th>
              <th className="w-24 px-2 py-2 text-right">Qty ordered</th>
              <th className="w-24 px-2 py-2 text-right">Price</th>
              <th className="w-20 px-2 py-2 text-right">Good</th>
              <th className="w-20 px-2 py-2 text-right">Damaged</th>
              <th className="w-8 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={line.id} className="border-b border-surface-border align-top last:border-0">
                <td className="py-2 pr-2">
                  {line.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={line.image_url}
                      alt={line.product_name || line.sku}
                      className="h-10 w-10 rounded border border-surface-border object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded border border-dashed border-surface-border bg-surface" />
                  )}
                </td>
                <td className="px-2 py-2">
                  <input
                    value={line.sku}
                    onChange={(e) => onSkuChange(line, e.target.value)}
                    placeholder="SKU"
                    className={input}
                    autoFocus={i === lines.length - 1 && i > 0}
                  />
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {line.lookup === "loading"
                      ? "Looking up…"
                      : line.lookup === "missing"
                        ? "Not in inventory - type the name"
                        : ""}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <input
                    value={line.product_name}
                    onChange={(e) => update(line.id, { product_name: e.target.value })}
                    placeholder="Filled from the SKU"
                    className={input}
                  />
                  {problems[i] && line.sku ? (
                    <div className="mt-0.5 text-[11px] text-red-600">{problems[i]}</div>
                  ) : null}
                </td>
                {["quantity_ordered", "unit_price", "good", "damaged"].map((field) => (
                  <td key={field} className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      step={field === "unit_price" ? "0.01" : "1"}
                      value={line[field]}
                      onChange={(e) => update(line.id, { [field]: e.target.value })}
                      placeholder="0"
                      className={numberInput}
                    />
                  </td>
                ))}
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== line.id) : prev))}
                    disabled={lines.length === 1}
                    aria-label="Remove product"
                    className="px-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          + Add product
        </button>
        <span className="text-sm text-slate-600">
          Total cost: <span className="font-semibold tabular-nums text-slate-900">{totalCost.toFixed(2)}</span>
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Good and Damaged are what has arrived so far - leave them at 0 if nothing has. Good units are added to the
        warehouse&apos;s stock.
      </p>

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={saving} disabled={!canSave} onClick={save}>
          Save PO
        </Button>
      </div>
    </Modal>
  );
}
