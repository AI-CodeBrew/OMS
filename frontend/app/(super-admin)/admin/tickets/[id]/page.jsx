"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import TicketConversation from "../../../../../components/tickets/TicketConversation";
import ticketsAdminService from "../../../../../services/ticketsAdminService";
import { InfoCard } from "../../../../../components/tickets/TicketInfoCards";
import { TICKET_STATUSES, TICKET_STATUS_LABEL } from "../../../../../components/tickets/ticketStatus";

// A dedicated page rather than an inline accordion on the list - status
// actions and a full conversation (including internal notes)
// is enough surface area to want its own screen, the way a real helpdesk
// console gives every ticket its own URL.
export default function AdminTicketDetailPage() {
  const params = useParams();
  const ticketId = params?.id;

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [settingStatus, setSettingStatus] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await ticketsAdminService.get(ticketId);
      setTicket(data.ticket);
    } catch (err) {
      setError(err.message || "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);


  async function onStatusChange(e) {
    const status = e.target.value;
    if (status === ticket.status) return;
    if (status === "resolved" && !window.confirm("Mark this ticket resolved?")) return;
    setSettingStatus(true);
    setError("");
    setSuccess("");
    try {
      const data = await ticketsAdminService.setStatus(ticketId, status);
      setTicket(data.ticket);
      setSuccess(`Ticket marked ${TICKET_STATUS_LABEL[status]}.`);
    } catch (err) {
      setError(err.message || "Failed to update status");
    } finally {
      setSettingStatus(false);
    }
  }

  if (loading) {
    return <p className="px-1 py-10 text-sm text-slate-500">Loading…</p>;
  }

  if (!ticket) {
    return (
      <div className="space-y-4">
        <Link href="/admin/tickets" className="text-sm text-brand-600 hover:underline">
          ← Back to Tickets
        </Link>
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Ticket not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/tickets" className="text-sm text-brand-600 hover:underline">
        ← Back to Tickets
      </Link>

      {error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm">
        <div className="bg-gradient-to-r from-brand-900 to-brand-600 px-5 py-4 text-white">
          <h1 className="text-lg font-semibold">Ticket {ticket.ticket_number}</h1>
        </div>
        <div className="p-5">
        <InfoCard label="Description">
          <p className="whitespace-pre-wrap">{ticket.description}</p>
        </InfoCard>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-surface-border pt-4">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Status
            <select
              value={ticket.status}
              onChange={onStatusChange}
              disabled={settingStatus}
              className="rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

        </div>
        </div>
      </div>

      <div className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <h2 className="mb-3 border-b border-surface-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
          Ticket History
        </h2>
        <TicketConversation
          ticketId={ticket.id}
          currentRole="super_admin"
          labels={{ tenant: "Customer", super_admin: "You" }}
          allowInternal
          listMessages={ticketsAdminService.listMessages}
          createMessage={ticketsAdminService.createMessage}
        />
      </div>
    </div>
  );
}
