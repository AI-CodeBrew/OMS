"use client";

import { useEffect, useState } from "react";
import Button from "../../shared/Button";
import ticketsService from "../../../services/ticketsService";
import CreateTicketDialog from "../../tickets/CreateTicketDialog";
import TicketDetailDialog from "../../tickets/TicketDetailDialog";
import { timeAgo } from "../../../lib/timeAgo";
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_DOT,
} from "../../tickets/ticketStatus";

function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// Every ticket raised on this order, visible to any org member who can see
// the order - unlike the /tickets sidebar page, this is deliberately not
// filtered to "tickets I raised" (see TicketViewSet.get_queryset).
export default function OrderTicketsTab({ order }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await ticketsService.list({ order: order.id, page_size: 100 });
      setTickets(data.results || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setCreating(true)}>Raise Ticket</Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-slate-500">No tickets raised for this order.</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-md border border-surface-border bg-white px-3 py-2 text-sm"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  TICKET_PRIORITY_DOT[t.priority] || "bg-slate-400"
                }`}
                title={`${TICKET_PRIORITY_LABEL[t.priority] || t.priority} priority`}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">
                  <span className="mr-1.5 font-mono text-xs font-normal text-slate-400">
                    {t.ticket_number}
                  </span>
                  {t.category}
                  {t.sub_category ? ` — ${t.sub_category}` : ""}
                </p>
                <p className="text-xs text-slate-400" title={new Date(t.created_at).toLocaleString()}>
                  {timeAgo(t.created_at)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  TICKET_STATUS_TONE[t.status] || "bg-slate-100 text-slate-600"
                }`}
              >
                {TICKET_STATUS_LABEL[t.status] || t.status}
              </span>
              <button
                type="button"
                aria-label="View ticket"
                onClick={() => setViewing(t)}
                className="shrink-0 text-slate-400 hover:text-slate-600"
              >
                <EyeIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreateTicketDialog
        open={creating}
        order={order}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          load();
        }}
      />
      <TicketDetailDialog ticket={viewing} open={Boolean(viewing)} onClose={() => setViewing(null)} />
    </div>
  );
}
