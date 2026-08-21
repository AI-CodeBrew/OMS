"use client";

import { useEffect, useState } from "react";
import ordersService from "../../../services/ordersService";
import Button from "../../../components/shared/Button";

const EMPTY_FORM = {
  order_number: "",
  customer_name: "",
  customer_phone: "",
  product_name: "",
  quantity: 1,
  unit_price: "",
};

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  async function loadOrders() {
    setLoading(true);
    setError("");
    try {
      const data = await ordersService.list();
      setOrders(data);
    } catch (err) {
      setError(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  async function onCreate(e) {
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
      await loadOrders();
    } catch (err) {
      setError(err.message || "Failed to create order");
    } finally {
      setCreating(false);
    }
  }

  function updateField(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Orders</h1>
      <p className="mt-1 text-sm text-slate-500">
        {orders.length} order{orders.length === 1 ? "" : "s"} for your organization.
      </p>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form
        onSubmit={onCreate}
        className="mt-6 grid grid-cols-2 gap-3 rounded-lg border border-surface-border bg-white p-4 sm:grid-cols-3"
      >
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
        <div className="col-span-2 sm:col-span-3">
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create order"}
          </Button>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto rounded-lg border border-surface-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border bg-surface text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Order #</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Items</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No orders yet.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="border-b border-surface-border last:border-0">
                  <td className="px-4 py-2 font-medium text-slate-900">{order.order_number}</td>
                  <td className="px-4 py-2">{order.customer_name}</td>
                  <td className="px-4 py-2 capitalize">{order.status}</td>
                  <td className="px-4 py-2">{order.total_amount}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {order.items.map((i) => i.product_name).join(", ")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
