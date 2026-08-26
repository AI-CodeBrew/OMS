"use client";

import { useEffect, useState } from "react";
import Button from "../../shared/Button";
import ordersService from "../../../services/ordersService";
import { STATUS_LABELS } from "../statusConfig";

export default function SplitOrdersTab({ orderId, items, onSplit }) {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await ordersService.listSplitOrders(orderId);
      setChildren(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!itemId || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await ordersService.createSplit(orderId, [{ item_id: itemId, quantity: Number(quantity) || 1 }]);
      setItemId("");
      setQuantity(1);
      await load();
      onSplit?.();
    } catch (err) {
      setError(err.message || "Failed to split order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {items.length > 0 ? (
        <form onSubmit={onSubmit} className="mb-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Item</span>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
            >
              <option value="">Select item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.product_name} (x{i.quantity})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Quantity</span>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-24 rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Splitting…" : "Create split order"}
          </Button>
        </form>
      ) : null}

      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : children.length === 0 ? (
        <p className="text-sm text-slate-500">No split orders yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Order</th>
              <th className="py-1">Status</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {children.map((c) => (
              <tr key={c.id} className="border-t border-surface-border">
                <td className="py-1.5 font-medium text-slate-900">{c.order_number}</td>
                <td className="py-1.5">{STATUS_LABELS[c.status] || c.status}</td>
                <td className="py-1.5 text-right">{c.total_amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
