"use client";

import Checkbox from "../shared/Checkbox";
import Dropdown from "../shared/Dropdown";
import FynkTechDispatchTag from "./FynkTechDispatchTag";
import { formatPakPhone } from "../../lib/formatPhone";
import { STATUS_LABELS, STATUS_TABS } from "./statusConfig";

// Badge colours for the Status column, by the same tone the status tabs use.
const TONE_BADGE = {
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  indigo: "bg-indigo-50 text-indigo-700",
  green: "bg-green-50 text-green-700",
  red: "bg-red-50 text-red-700",
};
const STATUS_TONE = Object.fromEntries(STATUS_TABS.map((tab) => [tab.value, tab.tone]));

function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  onOpenDetail,
  showStoreColumn = false,
  showTransitColumn = false,
  // The courier's own word for where the parcel is (Order.courier_status) -
  // shown on the tabs after dispatch, where several of them share one status.
  showSubStatusColumn = false,
  // Row ⋮ menu: opens the Manual Order form pre-filled from this order.
  onRecreate,
}) {
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
  const someSelected = orders.some((o) => selectedIds.has(o.id));
  const columnCount =
    (showStoreColumn ? 17 : 16) + (showTransitColumn ? 1 : 0) + (showSubStatusColumn ? 1 : 0);

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
            <th className="w-36 px-3 py-2">Status</th>
            <th className="w-28 px-3 py-2">Store Name</th>
            <th className="w-28 px-3 py-2">City</th>
            <th className="w-24 px-3 py-2">Courier</th>
            {showSubStatusColumn ? <th className="w-40 px-3 py-2">Sub Status</th> : null}
            {showTransitColumn ? <th className="w-24 px-3 py-2">In Transit</th> : null}
            <th className="w-32 px-3 py-2">Tracking ID (CN)</th>
            <th className="w-20 px-3 py-2">Tag</th>
            <th className="w-24 px-3 py-2 text-right">Amount</th>
            <th className="w-28 px-3 py-2">Payment Status</th>
            <th className="w-10 px-2 py-2" aria-label="Actions" />
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
              <tr
                key={order.id}
                className="border-b border-surface-border last:border-0 hover:bg-surface/60"
              >
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
                {/* The store's order number is what opens the order - the
                    rest of the row stays free for selecting and copying. */}
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(order.id)}
                      title={`Open order ${order.order_number}`}
                      className="truncate font-semibold text-brand-600 hover:text-brand-700 hover:underline focus:outline-none focus-visible:underline"
                    >
                      {String(order.order_number ?? "").replace(/^#/, "")}
                    </button>
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
                <td className="px-3 py-1.5 text-slate-700">
                  <div className="capitalize">{order.fulfillment_status}</div>
                  {/* Who ships it - kept off the Courier column, which names
                      only the courier. */}
                  {order.dispatched_by_fynktech ? (
                    <div className="mt-0.5">
                      <FynkTechDispatchTag />
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      TONE_BADGE[STATUS_TONE[order.status]] || "bg-slate-100 text-slate-700"
                    }`}
                    title={statusLabel(order.status)}
                  >
                    {statusLabel(order.status)}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-700">{order.shop || "—"}</td>
                <td className="px-3 py-1.5 text-slate-700">{order.city || "—"}</td>
                <td className="px-3 py-1.5 text-slate-700">
                  <div className="truncate">{order.courier_name || "—"}</div>
                </td>
                {showSubStatusColumn ? (
                  <td className="px-3 py-1.5 text-slate-700">
                    <div className="truncate" title={order.courier_status || undefined}>
                      {order.courier_status || "—"}
                    </div>
                  </td>
                ) : null}
                {showTransitColumn ? (
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-red-600">
                    {order.in_transit_days != null
                      ? `${order.in_transit_days} day${order.in_transit_days === 1 ? "" : "s"}`
                      : "—"}
                  </td>
                ) : null}
                <td className="px-3 py-1.5 text-slate-500">{order.tracking_number || "—"}</td>
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
                  {/* What the customer pays - total_amount is the items before discounts. */}
                  {order.grand_total ?? order.total_amount}
                </td>
                <td className="px-3 py-1.5 capitalize text-slate-700">{order.payment_status}</td>
                <td className="px-2 py-1.5 text-right">
                  <Dropdown
                    align="right"
                    trigger={
                      <button
                        type="button"
                        aria-label="Order actions"
                        className="rounded px-2 py-1 text-slate-400 hover:bg-surface hover:text-slate-700"
                      >
                        ⋮
                      </button>
                    }
                    items={[{ key: "recreate", label: "Recreate order", onClick: () => onRecreate?.(order) }]}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
