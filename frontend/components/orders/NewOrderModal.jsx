"use client";

import { useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";

const EMPTY_FORM = {
  order_number: "",
  customer_name: "",
  customer_phone: "",
  product_name: "",
  quantity: 1,
  unit_price: "",
};

export default function NewOrderModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function updateField(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      await ordersService.create({
        order_number: form.order_number,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        items: [
          {
            product_name: form.product_name,
            quantity: Number(form.quantity) || 1,
            unit_price: form.unit_price || 0,
          },
        ],
      });
      setForm(EMPTY_FORM);
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create order");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="New order">
      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
        <input
          required
          placeholder="Order number"
          value={form.order_number}
          onChange={updateField("order_number")}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          required
          placeholder="Customer name"
          value={form.customer_name}
          onChange={updateField("customer_name")}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          placeholder="Customer phone"
          value={form.customer_phone}
          onChange={updateField("customer_phone")}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          required
          placeholder="Product name"
          value={form.product_name}
          onChange={updateField("product_name")}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          required
          type="number"
          min="1"
          placeholder="Qty"
          value={form.quantity}
          onChange={updateField("quantity")}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          required
          type="number"
          step="0.01"
          min="0"
          placeholder="Unit price"
          value={form.unit_price}
          onChange={updateField("unit_price")}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={creating}>
            Create order
          </Button>
        </div>
      </form>
    </Modal>
  );
}
