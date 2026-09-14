"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Button from "../../../../../components/shared/Button";
import TicketConversation from "../../../../../components/tickets/TicketConversation";
import ticketsAdminService from "../../../../../services/ticketsAdminService";
import useAuthStore from "../../../../../store/authStore";
import { timeAgo } from "../../../../../lib/timeAgo";
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_PRIORITY_LABEL,
} from "../../../../../components/tickets/ticketStatus";

const PRIORITIES = Object.keys(TICKET_PRIORITY_LABEL);

// A dedicated page rather than an inline accordion on the list - assign,
// priority, resolve and a full conversation (including internal notes)
// is enough surface area to want its own screen, the way a real helpdesk
// console gives every ticket its own URL.
export default function AdminTicketDetailPage() {
  const params = useParams();
  const ticketId = params?.id;
  const currentUser = useAuthStore((s) => s.user);

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resolving, setResolving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [settingPriority, setSettingPriority] = useState(false);

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

  const isMine = ticket?.assigned_to_user_id === currentUser?.id;

  async function onResolve() {
    if (!window.confirm("Mark this ticket resolved?")) return;
    setResolving(true);
    setError("");
    setSuccess("");
    try {
      const data = await ticketsAdminService.resolve(ticketId);
      setTicket(data.ticket);
      setSuccess("Ticket resolved.");
    } catch (err) {
      setError(err.message || "Failed to resolve");
    } finally {
      setResolving(false);
    }
  }

  async function onToggleAssign() {
    setAssigning(true);
    setError("");
    setSuccess("");
    try {
      const data = await ticketsAdminService.assignToMe(ticketId);
      setTicket(data.ticket);
    } catch (err) {
      setError(err.message || "Failed to update assignment");
    } finally {
      setAssigning(false);
    }
  }

  async function onPriorityChange(e) {
    const priority = e.target.value;
    setSettingPriority(true);
    setError("");
    try {
      const data = await ticketsAdminService.setPriority(ticketId, priority);
      setTicket(data.ticket);
    } catch (err) {
      setError(err.message || "Failed to update priority");
    } finally {
      setSettingPriority(false);
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

      <div className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-medium text-slate-400">{ticket.ticket_number}</p>
            <h1 className="mt-0.5 text-xl font-semibold text-slate-900">
              {ticket.category}
              {ticket.sub_category ? (
                <span className="font-normal text-slate-500"> — {ticket.sub_category}</span>
              ) : null}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {ticket.organization_name} ·{" "}
              {ticket.order_number ? `Order ${ticket.order_number} · ` : "Standalone · "}
              {ticket.created_by_email || "Unknown"} ·{" "}
              <span title={new Date(ticket.created_at).toLocaleString()}>
                {timeAgo(ticket.created_at)}
              </span>
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              TICKET_STATUS_TONE[ticket.status] || "bg-slate-100 text-slate-600"
            }`}
          >
            {TICKET_STATUS_LABEL[ticket.status] || ticket.status}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-surface-border pt-4">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Priority
            <select
              value={ticket.priority}
              onChange={onPriorityChange}
              disabled={settingPriority}
              className="rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <Button variant="secondary" loading={assigning} onClick={onToggleAssign}>
            {ticket.assigned_to_email
              ? isMine
                ? "Unassign from me"
                : `Reassign from ${ticket.assigned_to_email} to me`
              : "Assign to me"}
          </Button>

          {ticket.status !== "resolved" ? (
            <Button loading={resolving} onClick={onResolve} className="ml-auto">
              Resolve ticket
            </Button>
          ) : null}
        </div>

        <p className="mt-4 whitespace-pre-wrap rounded-lg border border-surface-border bg-surface/50 px-4 py-3 text-sm text-slate-700">
          {ticket.description}
        </p>
      </div>

      <div className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Conversation</h2>
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
