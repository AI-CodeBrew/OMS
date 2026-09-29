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
      const data = await barqraftarService.getPayments({ dateFrom, dateTo, limit: 100 });
      setPayments(data.payments || []);
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
        // Row fields per BarqRaftar's docs (company_payments.data[]).
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="py-2">Invoice</th>
              <th className="py-2">Date</th>
              <th className="py-2">Orders</th>
              <th className="py-2">COD Collected</th>
              <th className="py-2">Shipping</th>
              <th className="py-2">Net Payable</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {payments.map((row) => {
              const id = row.id;
              return (
                <tr key={id}>
                  <td className="py-2">{row.invoice_number || `#${id}`}</td>
                  <td className="py-2">{row.created_at || "-"}</td>
                  <td className="py-2">{row.orders_count ?? "-"}</td>
                  <td className="py-2">{row.net_collected_amount ?? "-"}</td>
                  <td className="py-2">{row.net_shipping_charges ?? row.shipping_charges ?? "-"}</td>
                  <td className="py-2 font-medium">{row.net_payable ?? "-"}</td>
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
          // {"company_payment": {...}, "orders": [{"order": {...}}]} per
          // BarqRaftar's docs.
          <div className="space-y-3">
            {detail.company_payment ? (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-slate-500">Invoice</div>
                  <div>{detail.company_payment.invoice_number}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">COD Collected</div>
                  <div>{detail.company_payment.net_collected_amount}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Shipping</div>
                  <div>{detail.company_payment.net_shipping_charges}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Net Payable</div>
                  <div className="font-medium">{detail.company_payment.net_payable}</div>
                </div>
              </div>
            ) : null}
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="uppercase text-slate-500">
                  <th className="py-1">Tracking</th>
                  <th className="py-1">Order</th>
                  <th className="py-1">Customer</th>
                  <th className="py-1">COD</th>
                  <th className="py-1">Delivered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {(detail.orders || []).map((item) => {
                  const o = item.order || {};
                  return (
                    <tr key={item.id || o.id}>
                      <td className="py-1">{o.number}</td>
                      <td className="py-1">{o.customer_reference}</td>
                      <td className="py-1">{o.customer_name}</td>
                      <td className="py-1">{o.cod_amount}</td>
                      <td className="py-1">{o.delivered_at || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
