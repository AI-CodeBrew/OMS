"use client";

import Badge from "../shared/Badge";
import { STATUS_LABELS, cardTab, latestTag } from "./statusConfig";

import { formatDateTime } from "../../lib/formatDate";
const SELECT_CLASS =
  "mt-0.5 w-full rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500";

// Beside the order number at the top of the detail: Status - only ever
// one of our cards (Awaiting Confirmation, Approved, Assigning Courier,
// Dispatched, ...), never the backend's own status (Ready to Print, ...) -
// then Sub Status (the courier's word) and the Tags (ours and the order's).
export function OrderStatusBadge({ order }) {
  const card = cardTab(order.workflow_card)?.label;
  return (
    <>
      <Badge variant="brand">{card || STATUS_LABELS[order.status] || order.status}</Badge>
      {order.courier_status ? (
        <span className="text-xs font-normal text-slate-500">Sub status: {order.courier_status}</span>
      ) : null}
      {/* One tag - the latest (statusConfig.latestTag). */}
      {(() => {
        const tag = latestTag(order);
        if (!tag || tag.text === card) return null;
        return <Badge variant={tag.own ? "green" : "amber"}>{tag.text}</Badge>;
      })()}
    </>
  );
}

// The order's payment/date/source block - sits below the items and money
// in the detail panel. Edited through the panel's single Edit. The status
// is at the top, beside the order number (OrderStatusBadge).
export default function OrderDetailHeader({ order, draft, editing, onChange }) {
  // Order Type: COD / Prepaid (payment_gateway "cod" / anything else), or
  // Partially Paid (payment_status) - which opens Amount Paid / Receivable
  // for typing in the money boxes (OrderMoneySummary), so they update.
  const isCod = order.payment_gateway === "cod";
  const prepaidValue = isCod ? "cc" : order.payment_gateway || "cc";
  const typeOf = (o) =>
    o.payment_status === "partially_paid" ? "partial" : o.payment_gateway === "cod" ? "cod" : "prepaid";
  const savedType = typeOf(order);
  const TYPE_LABELS = { cod: "COD", prepaid: "Prepaid", partial: "Partially Paid" };
  const TYPE_BADGES = { cod: "amber", prepaid: "green", partial: "brand" };

  function pickType(next) {
    if (next === "partial") {
      onChange("payment_status", "partially_paid");
      return;
    }
    onChange("payment_gateway", next === "cod" ? "cod" : prepaidValue);
    // Leaving Partially Paid: back to the order's own non-partial status.
    if (draft.payment_status === "partially_paid") {
      onChange("payment_status", order.payment_status !== "partially_paid" ? order.payment_status : "pending");
    }
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-surface-border pt-4 sm:grid-cols-3">
      <div>
        <div className="text-xs text-slate-500">Order Type</div>
        {editing ? (
          <select value={typeOf(draft)} onChange={(e) => pickType(e.target.value)} className={SELECT_CLASS}>
            <option value="cod">COD</option>
            <option value="prepaid">Prepaid</option>
            <option value="partial">Partially Paid</option>
          </select>
        ) : (
          <Badge variant={TYPE_BADGES[savedType]}>{TYPE_LABELS[savedType]}</Badge>
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
            ? formatDateTime(order.placed_at || order.created_at)
            : "N/A"}
        </div>
      </div>
    </div>
  );
}
