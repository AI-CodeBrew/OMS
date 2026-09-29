"use client";

import { useEffect, useState } from "react";
import Button from "../../../../../components/shared/Button";
import Modal from "../../../../../components/shared/Modal";
import barqraftarService from "../_lib/barqraftarService";

function todayMinus(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function PaymentsTab({ onError }) {
  const [dateFrom, setDateFrom] = useState(todayMinus(30));
  const [dateTo, setDateTo] = useState(todayMinus(0));
  const [payments, setPayments] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadPayments() {
    setLoading(true);
    onError("");
    try {
      const data = await barqraftarService.getPayments({ dateFrom, dateTo });
      const list = Array.isArray(data) ? data : data.payments || data.data || [];
      setPayments(list);
    } catch (err) {
      onError(err.message || "Failed to load payments");
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onFilter(e) {
    e.preventDefault();
    loadPayments();
  }

  async function openDetail(row) {
    const id = row.id ?? row.payment_id;
    setDetailId(id);
    setDetailLoading(true);
    setDetail(null);
    onError("");
    try {
      const data = await barqraftarService.getPaymentDetail(id);
      setDetail(data);
    } catch (err) {
      onError(err.message || "Failed to load payment detail");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">Payments</h3>

      <form onSubmit={onFilter} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !payments || payments.length === 0 ? (
        <p className="text-sm text-slate-500">No payments in this range.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="py-2">Payment</th>
              <th className="py-2">Date</th>
              <th className="py-2">Amount</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {payments.map((row) => {
              const id = row.id ?? row.payment_id;
              return (
                <tr key={id}>
                  <td className="py-2">{row.reference || row.title || `#${id}`}</td>
                  <td className="py-2">{row.date || row.created_at || "-"}</td>
                  <td className="py-2">{row.amount ?? row.total ?? "-"}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openDetail(row)}
                      className="text-brand-700 hover:underline"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} title="Payment detail" width="max-w-2xl">
        {detailLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : detail ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
            {JSON.stringify(detail, null, 2)}
          </pre>
        ) : null}
      </Modal>
    </div>
  );
}
