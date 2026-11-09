"use client";

import { useEffect, useState } from "react";
import ordersService from "../../../services/ordersService";
import { STATUS_LABELS, cardTab } from "../statusConfig";

import { formatDate } from "../../../lib/formatDate";
export default function CustomerHistoryTab({ orderId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ordersService
      .listCustomerHistory(orderId)
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (orders.length === 0) return <p className="text-sm text-slate-500">No other orders from this customer.</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr>
          <th className="py-1">Order</th>
          <th className="py-1">Status</th>
          <th className="py-1">Date</th>
          <th className="py-1 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-t border-surface-border">
            <td className="py-1.5 font-medium text-slate-900">{o.order_number}</td>
            <td className="py-1.5">{cardTab(o.workflow_card)?.label || STATUS_LABELS[o.status] || o.status}</td>
            <td className="py-1.5 text-slate-500">{formatDate(o.created_at)}</td>
            <td className="py-1.5 text-right">{o.total_amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
