"use client";

import { timeAgo } from "../../lib/timeAgo";
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE, TICKET_TYPE_LABEL } from "./ticketStatus";

const TYPE_TONE = {
  customer: "bg-sky-50 text-sky-700",
  admin: "bg-brand-50 text-brand-700",
};

// The ticket lists as a table, laid out like the Orders table: ticket
// number first and bold (it's what opens the ticket), then who/what/where,
// status as a badge. showStore: the super admin's cross-store list. onOpen(ticket) opens it - a dialog on the store side,
// the ticket's own page for the super admin.
export default function TicketsTable({ tickets, loading, emptyText, onOpen, showStore = false }) {
  const columnCount = 7 + (showStore ? 1 : 0);

  return (
    <div className="overflow-auto rounded-lg border border-surface-border bg-white">
      <table className={`w-full table-fixed text-left ${showStore ? "min-w-[1120px]" : "min-w-[980px]"}`}>
        <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-32 px-3 py-2">Ticket No.</th>
            {showStore ? <th className="w-36 px-3 py-2">Store</th> : null}
            <th className="w-28 px-3 py-2">Type</th>
            <th className="w-28 px-3 py-2">Order</th>
            <th className="w-64 px-3 py-2">Category</th>
            <th className="w-36 px-3 py-2">Status</th>
            <th className="w-44 px-3 py-2">Raised By</th>
            <th className="w-40 px-3 py-2">Date &amp; Time</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {loading && tickets.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-8 text-center text-slate-500">
                Loading…
              </td>
            </tr>
          ) : tickets.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-8 text-center text-slate-500">
                {emptyText}
              </td>
            </tr>
          ) : (
            tickets.map((t) => (
              <tr
                key={t.id}
                onClick={() => onOpen(t)}
                className="cursor-pointer border-b border-surface-border last:border-0 hover:bg-surface/60"
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(t);
                    }}
                    className="font-mono font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                  >
                    {t.ticket_number}
                  </button>
                </td>
                {showStore ? (
                  <td className="px-3 py-2 text-slate-700">
                    <div className="truncate" title={t.organization_name}>
                      {t.organization_name || "—"}
                    </div>
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      TYPE_TONE[t.ticket_type] || "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {TICKET_TYPE_LABEL[t.ticket_type] || t.ticket_type || "—"}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {t.order_number ? String(t.order_number).replace(/^#/, "") : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="truncate text-slate-900" title={t.sub_category ? `${t.category} — ${t.sub_category}` : t.category}>
                    {t.category}
                    {t.sub_category ? <span className="text-slate-400"> — {t.sub_category}</span> : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      TICKET_STATUS_TONE[t.status] || "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {TICKET_STATUS_LABEL[t.status] || t.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  <div className="truncate" title={t.created_by_email}>
                    {t.created_by_email || "—"}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                  <div>
                    {new Date(t.created_at).toLocaleString([], {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="text-xs text-slate-400">{timeAgo(t.created_at)}</div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
