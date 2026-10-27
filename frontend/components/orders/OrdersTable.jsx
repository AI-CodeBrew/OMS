"use client";

import Checkbox from "../shared/Checkbox";
import Dropdown from "../shared/Dropdown";
import FynkTechDispatchTag from "./FynkTechDispatchTag";
import { formatPakPhone } from "../../lib/formatPhone";
import { STATUS_LABELS, cardTab } from "./statusConfig";

// Badge colours for the Status column, by the same tone the status tabs use.
const TONE_BADGE = {
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  indigo: "bg-indigo-50 text-indigo-700",
  green: "bg-green-50 text-green-700",
  red: "bg-red-50 text-red-700",
};

// The tag's colour (backend: oms.services.workflow_tag) - green when it's
// done its step, amber when it waits on someone, red when it went wrong.
const TAG_TONE = {
  Packed: "green",
  Delivered: "green",
  "To Be Packed": "amber",
  "Pending Approval": "amber",
  "City Issue": "amber",
  "Dispatch Issue": "red",
  "Cancelled from Assigning Courier": "red",
  "Courier Change Failed": "red",
  "No City Matched": "red",
  "Stock Not Available": "red",
  "Out for Delivery": "indigo",
  "In Transit": "indigo",
  Approved: "indigo",
  New: "blue",
};

function tagTone(order) {
  const tag = order.workflow_tag;
  if (TAG_TONE[tag]) return TAG_TONE[tag];
  // The courier's own word (a failed attempt, a return) or a cancel reason.
  if (order.workflow_card === "undelivered") return "amber";
  if (["return_in_transit", "returned", "cancelled"].includes(order.workflow_card)) return "red";
  return null;
}

// "Out for Delivery · Attempt 2" - from the second attempt on, so a first
// failed attempt and a retry read apart.
function tagText(order) {
  const attempts = order.delivery_attempts || 0;
  if (attempts > 1 && ["dispatched", "undelivered"].includes(order.workflow_card)) {
    return `${order.workflow_tag} · Attempt ${attempts}`;
  }
  return order.workflow_tag;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Mirrors oms.services.DISPATCH_REQUESTABLE_STATUSES - the flag only means
// something until a courier booking exists.
const DISPATCH_REQUESTABLE = new Set([
  "new", "pending_cc", "pending_cod", "city_issue", "awaiting_assigning", "awaiting_approval", "approved",
]);

// The "R" beside a replacement order's number (see Order.recreate_type).
export function ReplacementMark({ order, onDark = false }) {
  if (order.recreate_type !== "replacement") return null;
  return (
    <span
      className={`shrink-0 rounded px-1 text-[11px] font-bold ${
        onDark ? "bg-white text-brand-800" : "bg-orange-100 text-orange-700"
      }`}
      title={
        order.recreated_from_number
          ? `Replacement for order ${order.recreated_from_number}`
          : "Replacement order"
      }
    >
      R
    </span>
  );
}

// A small ticket symbol beside an order that has any support ticket - amber
// while one is still open, grey once they're all resolved.
export function TicketMark({ order, onDark = false }) {
  const total = order.ticket_count || 0;
  if (!total) return null;
  const open = order.open_ticket_count || 0;
  const tone = onDark
    ? "bg-white text-brand-800"
    : open
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-500";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 ${tone}`}
      title={`${total} ticket${total === 1 ? "" : "s"}${open ? ` (${open} open)` : " - all resolved"}`}
      aria-label="Has tickets"
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3" aria-hidden="true">
        <path
          d="M2.5 7.5A1.5 1.5 0 0 1 4 6h12a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 0 0 3v1A1.5 1.5 0 0 1 16 14H4a1.5 1.5 0 0 1-1.5-1.5v-1a1.5 1.5 0 0 0 0-3v-1Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default function OrdersTable({
  orders,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenDetail,
  showStoreColumn = false,
  // Product names of the order's line items (Dispatch Hub).
  showProductColumn = false,
  showTransitColumn = false,
  // The courier's own word for where the parcel is (Order.courier_status) -
  // shown on the tabs after dispatch, where several of them share one status.
  showSubStatusColumn = false,
  // Row ⋮ menu: "Recreate order" - the form then asks Replacement or New
  // order before opening pre-filled from this order.
  onRecreate,
}) {
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
  const someSelected = orders.some((o) => selectedIds.has(o.id));
  const columnCount =
    (showStoreColumn ? 17 : 16) +
    (showProductColumn ? 1 : 0) +
    (showTransitColumn ? 1 : 0) +
    (showSubStatusColumn ? 1 : 0);

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
            {showProductColumn ? <th className="w-48 px-3 py-2">Product</th> : null}
            <th className="w-32 px-3 py-2">Contact</th>
            <th className="w-40 px-3 py-2">Date &amp; Time</th>
            <th className="w-24 px-3 py-2">Fulfillment</th>
            <th className="w-36 px-3 py-2">Status</th>
            <th className="w-40 px-3 py-2">Tag</th>
            <th className="w-28 px-3 py-2">Store Name</th>
            <th className="w-28 px-3 py-2">City</th>
            <th className="w-24 px-3 py-2">Courier</th>
            {showSubStatusColumn ? <th className="w-40 px-3 py-2">Sub Status</th> : null}
            {showTransitColumn ? <th className="w-24 px-3 py-2">In Transit</th> : null}
            <th className="w-32 px-3 py-2">Tracking ID (CN)</th>
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
                    <ReplacementMark order={order} />
                    <TicketMark order={order} />
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
                {showProductColumn ? (
                  <td className="px-3 py-1.5 text-slate-700">
                    {(() => {
                      const names = (order.items || []).map((i) =>
                        i.quantity > 1 ? `${i.product_name} x ${i.quantity}` : i.product_name
                      );
                      return (
                        <div className="truncate" title={names.join(", ")}>
                          {names.join(", ") || "—"}
                        </div>
                      );
                    })()}
                  </td>
                ) : null}
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
                  {/* The card it's under; the exact status on hover. */}
                  {(() => {
                    const card = cardTab(order.workflow_card);
                    const label = card ? card.label : statusLabel(order.status);
                    return (
                      <span
                        className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          TONE_BADGE[card?.tone] || "bg-slate-100 text-slate-700"
                        }`}
                        title={`${label} - ${statusLabel(order.status)}`}
                      >
                        {label}
                      </span>
                    );
                  })()}
                </td>
                {/* Tag sits right after Status: where the order is within
                    its card (To Be Packed, Out for Delivery, the cancel
                    reason, the courier's remark, ...), then the order's own
                    free-form tag. */}
                <td className="px-3 py-1.5">
                  {order.tag || order.workflow_tag ? (
                    <div className="flex flex-col items-start gap-1">
                      {order.workflow_tag ? (
                        <span
                          className={`max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            TONE_BADGE[tagTone(order)] || "bg-slate-100 text-slate-700"
                          }`}
                          title={tagText(order)}
                        >
                          {tagText(order)}
                        </span>
                      ) : null}
                      {order.tag ? (
                        <span
                          className="max-w-full truncate rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                          title={order.tag}
                        >
                          {order.tag}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
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
                <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-900">
                  {/* What the customer pays - total_amount is the items before discounts. */}
                  {order.grand_total ?? order.total_amount}
                </td>
                <td className="px-3 py-1.5 capitalize text-slate-700">{order.payment_status?.replace("_", " ")}</td>
                <td className="px-2 py-1.5 text-right">
                  {onRecreate ? (
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
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
