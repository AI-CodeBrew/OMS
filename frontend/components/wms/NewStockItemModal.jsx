"use client";

import { useEffect, useState } from "react";
import wmsService from "../../services/wmsService";
import Modal from "../shared/Modal";
import Button from "../shared/Button";

const EMPTY = { sku: "", product_name: "", quantity: "0", reorder_level: "0" };

export default function NewStockItemModal({ open, warehouses, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [warehouseId, setWarehouseId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError("");
      // Default to the org's default warehouse, falling back to the first.
      const preferred = warehouses?.find((w) => w.is_default) || warehouses?.[0];
      setWarehouseId(preferred?.id || "");
    }
  }, [open, warehouses]);

  if (!open) return null;

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await wmsService.createStockItem({
        warehouse: warehouseId,
        sku: form.sku.trim(),
        product_name: form.product_name.trim(),
        quantity: parseInt(form.quantity, 10) || 0,
        reorder_level: parseInt(form.reorder_level, 10) || 0,
      });
      await onCreated?.();
    } catch (err) {
      setError(err.message || "Failed to create stock item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Add stock item" onClose={onClose}>
      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Warehouse</span>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            {(warehouses || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            SKU <span className="text-red-500">*</span>
          </span>
          <input
            required
            value={form.sku}
            onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Must match the SKU on your Shopify products, so orders can find this stock.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Product Name</span>
          <input
            value={form.product_name}
            onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>

        <div className="flex gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-700">Opening Quantity</span>
            <input
              type="number"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-700">Reorder Level</span>
            <input
              type="number"
              min="0"
              value={form.reorder_level}
              onChange={(e) => setForm((f) => ({ ...f, reorder_level: e.target.value }))}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !warehouseId}>
            {saving ? "Saving…" : "Add Item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
