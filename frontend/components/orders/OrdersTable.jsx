"use client";

import Checkbox from "../shared/Checkbox";
import OrderRowMenu from "./OrderRowMenu";
import { formatPakPhone } from "../../lib/formatPhone";

// Mirrors oms.services.DISPATCH_REQUESTABLE_STATUSES - the flag only means
// something until a courier booking exists.
const DISPATCH_REQUESTABLE = new Set([
  "new", "pending_cc", "pending_cod", "city_issue", "awaiting_assigning", "awaiting_approval", "approved",
]);

export default function OrdersTable({
  orders,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowAction,
  onOpenDetail,
  onRaiseTicket,
  showStoreColumn = false,
  showTransitColumn = false,
}) {
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
  const someSelected = orders.some((o) => selectedIds.has(o.id));
  const columnCount = (showStoreColumn ? 19 : 18) + (showTransitColumn ? 1 : 0);

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-surface-border bg-white">
      <table className="w-full table-fixed text-left">
        <thead className="sticky top-0 z-10 border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-10 px-3 py-2">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={() => onToggleSelectAll(orders)}
              />
            </th>
            {showStoreColumn ? <th className="w-28 px-3 py-2">Store</th> : null}
            <th className="w-16 px-3 py-2">OMS Order ID</th>
            <th className="w-28 px-3 py-2">Store Order ID</th>
            <th className="w-40 px-3 py-2">Customer Name</th>
            <th className="w-32 px-3 py-2">Contact</th>
            <th className="w-40 px-3 py-2">Date &amp; Time</th>
            <th className="w-24 px-3 py-2">Fulfillment</th>
            <th className="w-24 px-3 py-2">Pay. Status</th>
            <th className="w-28 px-3 py-2">Shop</th>
            <th className="w-56 px-3 py-2 pl-6">Product Name</th>
            <th className="w-28 px-3 py-2">City</th>
            <th className="w-24 px-3 py-2">Courier</th>
            {showTransitColumn ? <th className="w-24 px-3 py-2">In Transit</th> : null}
            <th className="w-32 px-3 py-2">Tracking ID (CN)</th>
            <th className="w-28 px-3 py-2 text-right">Delivery Charges</th>
            <th className="w-20 px-3 py-2">Tag</th>
            <th className="w-24 px-3 py-2 text-right">Amount</th>
            <th className="w-20 px-3 py-2" />
            <th className="w-10 px-3 py-2" />
          </tr>
        </thead>
        <tbody className="text-sm">
          {loading && orders.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-6 text-center text-slate-500">
                Loading…
              </td>
            </tr>
          ) : orders.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-6 text-center text-slate-500">
                No orders in this view.
              </td>
            </tr>
          ) : (
            orders.map((order) => (
              <tr key={order.id} className="border-b border-surface-border last:border-0 hover:bg-surface/60">
                <td className="px-3 py-1.5">
                  <Checkbox checked={selectedIds.has(order.id)} onChange={() => onToggleSelect(order.id)} />
                </td>
                {showStoreColumn ? (
                  <td className="px-3 py-1.5 text-slate-700">
                    <div className="truncate" title={order.store_name}>
                      {order.store_name || "—"}
                    </div>
                  </td>
                ) : null}
                <td className="px-3 py-1.5 text-slate-700">{order.supabase_order_no ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <span className="truncate font-semibold text-slate-900" title={order.order_number}>
                      {String(order.order_number ?? "").replace(/^#/, "")}
                    </span>
                    {order.dispatch_requested_at && DISPATCH_REQUESTABLE.has(order.status) ? (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1 text-xs text-amber-700"
                        title={
                          showStoreColumn
                            ? "Store sent this order for FynkTech to dispatch"
                            : "Sent to FynkTech for dispatch"
                        }
                        aria-label="Sent for dispatch"
                      >
                        🚚
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-slate-700">
                  <div className="truncate" title={order.customer_name}>
                    {order.customer_name}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-slate-500">{formatPakPhone(order.customer_phone) || "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">
                  {new Date(order.placed_at || order.created_at).toLocaleString([], {
                    year: "numeric",
                    month: "numeric",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-3 py-1.5 capitalize text-slate-700">{order.fulfillment_status}</td>
                <td className="px-3 py-1.5 capitalize text-slate-700">{order.payment_status}</td>
                <td className="px-3 py-1.5 text-slate-700">{order.shop || "—"}</td>
                <td className="px-3 py-1.5 pl-6 text-slate-700">
                  {order.items && order.items.length > 0 ? (
                    <div
                      className="truncate"
                      title={order.items.map((i) => i.product_name).join(", ")}
                    >
                      {order.items.map((i) => i.product_name).join(", ")}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-700">{order.city || "—"}</td>
                <td className="px-3 py-1.5 text-slate-700">{order.courier_name || "—"}</td>
                {showTransitColumn ? (
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-red-600">
                    {order.in_transit_days != null
                      ? `${order.in_transit_days} day${order.in_transit_days === 1 ? "" : "s"}`
                      : "—"}
                  </td>
                ) : null}
                <td className="px-3 py-1.5 text-slate-500">{order.tracking_number || "—"}</td>
                <td className="px-3 py-1.5 text-right text-slate-700">
                  {order.shipping_amount != null ? order.shipping_amount : "—"}
                </td>
                <td className="px-3 py-1.5">
                  {order.tag ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                      {order.tag}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
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
                  <OrderRowMenu order={order} onAction={onRowAction} onRaiseTicket={onRaiseTicket} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
