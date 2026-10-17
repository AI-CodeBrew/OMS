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
 *
 * Also edits the product name. On a Shopify-linked item both the rename
 * and the stock delta are queued for "Push to Shopify" rather than sent
 * straight away, so they can be reviewed together before going live.
 */
export default function StockAdjustModal({ item, onClose, onAdjusted }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("add");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(item?.product_name || "");
    setAmount("");
    setDirection("add");
    setNote("");
    setError("");
  }, [item]);

  if (!item) return null;

  const parsed = parseInt(amount, 10);
  const hasAmount = amount.trim() !== "";
  const validAmount = Number.isFinite(parsed) && parsed > 0;
  const delta = direction === "add" ? parsed : -parsed;
  const resulting = validAmount ? item.quantity + delta : item.quantity;
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== "" && trimmedName !== (item.product_name || "");
  // A cleared name field blocks saving rather than silently keeping the old name.
  const nameCleared = trimmedName === "" && Boolean(item.product_name);
  const valid = !nameCleared && (hasAmount ? validAmount : true) && (validAmount || nameChanged);

  async function onSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError("");
    try {
      await wmsService.adjustStock(item.id, {
        delta: validAmount ? delta : undefined,
        note: note.trim(),
        product_name: nameChanged ? trimmedName : undefined,
      });
      await onAdjusted?.();
    } catch (err) {
      setError(err.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Edit — ${item.sku || item.product_name || "item"}`} onClose={onClose}>
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
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Product name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {name.trim() === "" && item.product_name ? (
            <span className="mt-1 block text-xs text-red-600">Product name cannot be blank.</span>
          ) : null}
        </label>

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
          <span className="mb-1 block text-xs font-medium text-slate-700">
            Quantity <span className="text-slate-400">(leave blank to only rename)</span>
          </span>
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

        {validAmount ? (
          <p className="rounded-md bg-surface px-3 py-2 text-sm text-slate-600">
            New balance:{" "}
            <strong className={resulting < 0 ? "text-red-600" : "text-slate-900"}>{resulting}</strong>
            {resulting < 0 ? " (still negative)" : ""}
          </p>
        ) : null}

        <p className="text-xs text-slate-500">
          {item.shopify_linked
            ? "Saved here now. Use Push to Shopify on the Inventory page to send these changes to your store."
            : "Not linked to a Shopify product — changes stay in WMS only."}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid} loading={saving}>
            Apply
          </Button>
        </div>
      </form>
    </Modal>
  );
}
