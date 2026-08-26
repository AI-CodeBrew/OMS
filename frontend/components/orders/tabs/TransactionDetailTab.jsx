"use client";

import { useEffect, useState } from "react";
import Button from "../../shared/Button";
import Badge from "../../shared/Badge";
import ordersService from "../../../services/ordersService";

const EMPTY = { amount: "", method: "", status: "success", reference: "" };

export default function TransactionDetailTab({ orderId }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await ordersService.listTransactions(orderId);
      setTransactions(data);
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
    if (!form.amount || submitting) return;
    setSubmitting(true);
    try {
      await ordersService.createTransaction(orderId, form);
      setForm(EMPTY);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const statusVariant = { success: "green", pending: "amber", failed: "red" };

  return (
    <div>
      <form onSubmit={onSubmit} className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input
          required
          type="number"
          step="0.01"
          placeholder="Amount"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          className="rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <input
          placeholder="Method"
          value={form.method}
          onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
          className="rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          className="rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        >
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <input
          placeholder="Reference"
          value={form.reference}
          onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
          className="rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        <Button type="submit" disabled={submitting}>
          Add
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="text-sm text-slate-500">No transactions logged.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Amount</th>
              <th className="py-1">Method</th>
              <th className="py-1">Status</th>
              <th className="py-1">Reference</th>
              <th className="py-1">Date</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-t border-surface-border">
                <td className="py-1.5 font-medium text-slate-900">{t.amount}</td>
                <td className="py-1.5">{t.method || "—"}</td>
                <td className="py-1.5">
                  <Badge variant={statusVariant[t.status] || "neutral"}>{t.status}</Badge>
                </td>
                <td className="py-1.5 text-slate-500">{t.reference || "—"}</td>
                <td className="py-1.5 text-slate-500">{new Date(t.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
