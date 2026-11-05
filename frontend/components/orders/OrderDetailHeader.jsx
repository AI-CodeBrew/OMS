"use client";

import Badge from "../shared/Badge";
import { STATUS_LABELS, cardTab } from "./statusConfig";

const PAYMENT_STATUSES = [
  { value: "pending", label: "Pending", badge: "amber" },
  { value: "partially_paid", label: "Partially Paid", badge: "brand" },
  { value: "paid", label: "Paid", badge: "green" },
];

const SELECT_CLASS =
  "mt-0.5 w-full rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500";

// Beside the order number at the top of the detail: the card the order is
// in (Awaiting Confirmation, Dispatched, ...), and its own status too when
// that says more (City Issue, Out for Delivery, ...).
export function OrderStatusBadge({ order }) {
  const card = cardTab(order.workflow_card)?.label;
  const status = STATUS_LABELS[order.status] || order.status;
  return (
    <>
      <Badge variant="brand">{card || status}</Badge>
      {card && card !== status ? <Badge variant="neutral">{status}</Badge> : null}
      {/* Sub Status: the courier's own word for where the parcel is. */}
      {order.courier_status ? (
        <span className="text-xs font-normal text-slate-500">Sub status: {order.courier_status}</span>
      ) : null}
      {/* Both tags: where the order is within its card, then its own tag -
          the card's tag left out when it only repeats the status. */}
      {order.workflow_tag && order.workflow_tag !== status && order.workflow_tag !== card ? (
        <Badge variant="amber">{order.workflow_tag}</Badge>
      ) : null}
      {order.tag ? <Badge variant="green">{order.tag}</Badge> : null}
    </>
  );
}

// The order's payment/date/source block - sits below the items and money
// in the detail panel. Edited through the panel's single Edit. The status
// is at the top, beside the order number (OrderStatusBadge).
export default function OrderDetailHeader({ order, draft, editing, onChange }) {
  const payment = PAYMENT_STATUSES.find((p) => p.value === order.payment_status);

  return (
    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-surface-border pt-4 sm:grid-cols-3">
      <div>
        <div className="text-xs text-slate-500">Payment Status</div>
        {editing ? (
          <select
            value={draft.payment_status}
            onChange={(e) => onChange("payment_status", e.target.value)}
            className={SELECT_CLASS}
          >
            {PAYMENT_STATUSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <Badge variant={payment?.badge || "amber"}>{payment?.label || order.payment_status}</Badge>
        )}
      </div>
      {order.status === "cancelled" && order.cancel_reason ? (
        <div>
          <div className="text-xs text-slate-500">Cancel Reason</div>
          <div className="text-sm text-red-700">{order.cancel_reason}</div>
        </div>
      ) : null}
      <div>
        <div className="text-xs text-slate-500">Date</div>
        <div className="text-sm text-slate-900">
          {order.placed_at || order.created_at
            ? new Date(order.placed_at || order.created_at).toLocaleString()
            : "N/A"}
        </div>
      </div>
    </div>
  );
}
