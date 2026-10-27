"use client";

import Badge from "../shared/Badge";
import { STATUS_LABELS } from "./statusConfig";

const PAYMENT_STATUSES = [
  { value: "pending", label: "Pending", badge: "amber" },
  { value: "partially_paid", label: "Partially Paid", badge: "brand" },
  { value: "paid", label: "Paid", badge: "green" },
];

// What a sync fills in on its own (Storefront / Manual from Shopify) plus
// the channels a store sets by hand.
const ORDER_SOURCES = ["Storefront", "WhatsApp", "Manual"];

const SELECT_CLASS =
  "mt-0.5 w-full rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500";

// The order's status/payment/source block - sits below the items and money
// in the detail panel. Edited through the panel's single Edit.
export default function OrderDetailHeader({ order, draft, editing, onChange }) {
  const payment = PAYMENT_STATUSES.find((p) => p.value === order.payment_status);
  // Keep a source we don't list (an older free-text value) selectable
  // rather than silently swapping it for the first option.
  const sources =
    draft.order_source && !ORDER_SOURCES.includes(draft.order_source)
      ? [draft.order_source, ...ORDER_SOURCES]
      : ORDER_SOURCES;

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
      <div>
        <div className="text-xs text-slate-500">Status</div>
        <Badge variant="brand">{STATUS_LABELS[order.status] || order.status}</Badge>
        {order.status === "cancelled" && order.cancel_reason ? (
          <div className="mt-1 text-xs text-red-700">Reason: {order.cancel_reason}</div>
        ) : null}
      </div>
      <div>
        <div className="text-xs text-slate-500">Date</div>
        <div className="text-sm text-slate-900">
          {order.placed_at || order.created_at
            ? new Date(order.placed_at || order.created_at).toLocaleString()
            : "N/A"}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-500">Order Source</div>
        {editing ? (
          <select
            value={draft.order_source || ""}
            onChange={(e) => onChange("order_source", e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-slate-900">{order.order_source || "N/A"}</div>
        )}
      </div>
    </div>
  );
}
