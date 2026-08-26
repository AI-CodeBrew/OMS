"use client";

import { useEffect, useState } from "react";
import wmsService from "../../services/wmsService";
import Modal from "../shared/Modal";
import Button from "../shared/Button";

/**
 * Manual stock correction - receiving new inventory, writing off damage,
 * or clearing a negative balance left by an over-shipped order. Records a
 * signed delta rather than setting an absolute quantity, so the movement
 * ledger keeps a truthful history of what changed and why.
 */
export default function StockAdjustModal({ item, onClose, onAdjusted }) {
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("add");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAmount("");
    setDirection("add");
    setNote("");
    setError("");
  }, [item]);

  if (!item) return null;

  const parsed = parseInt(amount, 10);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const delta = direction === "add" ? parsed : -parsed;
  const resulting = valid ? item.quantity + delta : item.quantity;

  async function onSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError("");
    try {
      await wmsService.adjustStock(item.id, { delta, note: note.trim() });
      await onAdjusted?.();
    } catch (err) {
      setError(err.message || "Failed to adjust stock");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Adjust stock — ${item.sku}`} onClose={onClose}>
      <p className="text-sm text-slate-500">
        {item.product_name || item.sku} · currently{" "}
        <strong className={item.quantity < 0 ? "text-red-600" : "text-slate-800"}>
          {item.quantity}
        </strong>{" "}
        on hand
      </p>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="flex gap-1.5">
          {[
            { value: "add", label: "Add stock" },
            { value: "remove", label: "Remove stock" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDirection(opt.value)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                direction === opt.value
                  ? "border-brand-800 bg-brand-800 text-white"
                  : "border-surface-border bg-white text-slate-600 hover:bg-surface"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Quantity</span>
          <input
            autoFocus
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            Reason <span className="text-slate-400">(optional)</span>
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Stock count correction, damaged units"
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>

        {valid ? (
          <p className="rounded-md bg-surface px-3 py-2 text-sm text-slate-600">
            New balance:{" "}
            <strong className={resulting < 0 ? "text-red-600" : "text-slate-900"}>{resulting}</strong>
            {resulting < 0 ? " (still negative)" : ""}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? "Saving…" : "Apply"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
