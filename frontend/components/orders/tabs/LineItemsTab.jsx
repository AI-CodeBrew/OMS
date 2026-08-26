"use client";

import { useState } from "react";
import Button from "../../shared/Button";
import EditableField from "../../shared/EditableField";
import ordersService from "../../../services/ordersService";

const ITEM_FIELDS = [
  ["product_name", "Product", "text"],
  ["vendor", "Vendor", "text"],
  ["barcode", "Barcode", "text"],
  ["unit_price", "Price", "number"],
  ["compare_at_price", "Compare At Price", "number"],
  ["quantity", "Qty", "number"],
  ["discount_amount", "Discount Amount", "number"],
  ["weight_grams", "Weight (grams)", "number"],
];

function serializeItem(source, overrides = {}) {
  return {
    product_name: overrides.product_name ?? source.product_name,
    quantity: Number(overrides.quantity ?? source.quantity) || 1,
    unit_price: overrides.unit_price ?? source.unit_price ?? 0,
    vendor: overrides.vendor ?? source.vendor ?? "",
    barcode: overrides.barcode ?? source.barcode ?? "",
    compare_at_price: overrides.compare_at_price ?? source.compare_at_price ?? null,
    discount_amount: overrides.discount_amount ?? source.discount_amount ?? 0,
    weight_grams: overrides.weight_grams ?? source.weight_grams ?? null,
  };
}

export default function LineItemsTab({ order, onOrderChanged }) {
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemDraft, setItemDraft] = useState({});
  const [saving, setSaving] = useState(false);

  function startEdit(item) {
    setEditingItemId(item.id);
    setItemDraft({ ...item });
  }

  async function save() {
    setSaving(true);
    try {
      const items = order.items.map((i) =>
        i.id === editingItemId ? serializeItem(i, itemDraft) : serializeItem(i)
      );
      await ordersService.update(order.id, { items });
      setEditingItemId(null);
      onOrderChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 rounded-md bg-brand-800 px-4 py-3 text-sm text-white sm:grid-cols-5">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Order</div>
          {order.order_number}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Location</div>
          {order.city || "—"}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Courier Status</div>
          {order.courier_name || "Unassigned"}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Fulfillment Status</div>
          {order.fulfillment_status}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Tracking Number</div>
          {order.tracking_number || "N/A"}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {order.items.map((item) => (
          <div key={item.id} className="rounded-md border border-surface-border bg-white p-3">
            {editingItemId === item.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {ITEM_FIELDS.map(([field, label, type]) => (
                    <EditableField
                      key={field}
                      label={label}
                      type={type}
                      editing
                      value={itemDraft[field]}
                      onChange={(v) => setItemDraft((d) => ({ ...d, [field]: v }))}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditingItemId(null)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{item.product_name}</p>
                  <p className="text-xs text-slate-500">
                    {item.weight_grams ? `Weight: ${item.weight_grams} Grams` : "Weight: N/A"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-6 text-sm text-slate-600">
                  <div>
                    <div className="text-xs text-slate-400">Vendor</div>
                    {item.vendor || "—"}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Barcode</div>
                    {item.barcode || "—"}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Price</div>
                    {item.unit_price}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Compare At Price</div>
                    {item.compare_at_price ?? "—"}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">QTY</div>
                    {item.quantity}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Discount Amount</div>
                    {item.discount_amount}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Total</div>
                    {(item.quantity * item.unit_price - (item.discount_amount || 0)).toFixed(2)}
                  </div>
                </div>
                <Button variant="secondary" onClick={() => startEdit(item)}>
                  Edit
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
