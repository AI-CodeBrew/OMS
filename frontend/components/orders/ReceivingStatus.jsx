"use client";

// Receiving Status (user, 2026-11-26 - backend oms.services.receiving_status):
// what the Returns Desk did with a return's parcel - "Not Received", or
// "Received - Good" / "Received - Damaged" / "Received - Good / Damaged /
// Lost". Shown on Orders' Return in Transit and Returned cards and on the
// Returns Desk - the tag stays the courier mapping's.

import { formatDateTime } from "../../lib/formatDate";

export function receivingTone(text) {
  if (!text) return "";
  if (!text.startsWith("Received")) return "bg-slate-100 text-slate-600 ring-slate-200";
  return /Damaged|Lost/.test(text)
    ? "bg-red-50 text-red-700 ring-red-200"
    : "bg-emerald-50 text-emerald-700 ring-emerald-200";
}

export default function ReceivingStatus({ order, showWhen = true }) {
  const text = order?.receiving_status || "";
  if (!text) return <span className="text-slate-300">—</span>;
  const received = Boolean(order.return_received_at);
  const title = received
    ? `Scanned at the Returns Desk ${formatDateTime(order.return_received_at)}${
        order.return_received_by_email ? ` by ${order.return_received_by_email}` : ""
      }`
    : "The Returns Desk hasn't scanned this parcel yet - it can be scanned in Return in Transit too.";
  return (
    <div className="max-w-[12rem]" title={title}>
      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${receivingTone(text)}`}>
        {text}
      </span>
      {received && showWhen ? (
        <div className="mt-0.5 truncate text-[11px] text-slate-400">{formatDateTime(order.return_received_at)}</div>
      ) : null}
    </div>
  );
}
