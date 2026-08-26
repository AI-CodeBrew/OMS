"use client";

import Checkbox from "../shared/Checkbox";
import ProbabilityBadge from "./ProbabilityBadge";
import OrderRowMenu from "./OrderRowMenu";
import { STATUS_LABELS } from "./statusConfig";

export default function OrdersTable({
  orders,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowAction,
  onOpenDetail,
}) {
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
  const someSelected = orders.some((o) => selectedIds.has(o.id));

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-surface-border bg-white">
      <table className="w-full text-left">
        <thead className="sticky top-0 z-10 border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={() => onToggleSelectAll(orders)}
              />
            </th>
            <th className="px-3 py-2">Order</th>
            <th className="px-3 py-2">Priority</th>
            <th className="px-3 py-2">Cus. Name</th>
            <th className="px-3 py-2">Contact</th>
            <th className="px-3 py-2">Date &amp; Time</th>
            <th className="px-3 py-2">Fulfillment</th>
            <th className="px-3 py-2">Pay. Status</th>
            <th className="px-3 py-2">Shop</th>
            <th className="px-3 py-2">City</th>
            <th className="px-3 py-2">Gateway</th>
            <th className="px-3 py-2">Courier</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2" />
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="text-sm">
          {loading ? (
            <tr>
              <td colSpan={15} className="px-4 py-6 text-center text-slate-500">
                Loading…
              </td>
            </tr>
          ) : orders.length === 0 ? (
            <tr>
              <td colSpan={15} className="px-4 py-6 text-center text-slate-500">
                No orders in this view.
              </td>
            </tr>
          ) : (
            orders.map((order) => (
              <tr key={order.id} className="border-b border-surface-border last:border-0 hover:bg-surface/60">
                <td className="px-3 py-1.5">
                  <Checkbox checked={selectedIds.has(order.id)} onChange={() => onToggleSelect(order.id)} />
                </td>
                <td className="px-3 py-1.5">
                  <div className="font-semibold text-slate-900">{order.order_number}</div>
                  <div className="text-[11px] text-slate-400">{STATUS_LABELS[order.status] || order.status}</div>
                </td>
                <td className="px-3 py-1.5">
                  <ProbabilityBadge
                    cancelledPct={order.cancelled_pct}
                    returnedPct={order.returned_pct}
                    deliveredPct={order.delivered_pct}
                  />
                </td>
                <td className="px-3 py-1.5 text-slate-700">{order.customer_name}</td>
                <td className="px-3 py-1.5 text-slate-500">{order.customer_phone || "—"}</td>
                <td className="px-3 py-1.5 text-slate-500">
                  {new Date(order.placed_at || order.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-1.5 capitalize text-slate-700">{order.fulfillment_status}</td>
                <td className="px-3 py-1.5 capitalize text-slate-700">{order.payment_status}</td>
                <td className="px-3 py-1.5 text-slate-700">{order.shop || "—"}</td>
                <td className="px-3 py-1.5 text-slate-700">{order.city || "—"}</td>
                <td className="px-3 py-1.5 uppercase text-slate-700">{order.payment_gateway}</td>
                <td className="px-3 py-1.5 text-slate-700">{order.courier_name || "—"}</td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-900">
                  {order.total_amount}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onOpenDetail(order.id)}
                    className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-surface"
                  >
                    Details
                  </button>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <OrderRowMenu order={order} onAction={onRowAction} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
