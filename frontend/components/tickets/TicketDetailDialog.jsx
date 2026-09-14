"use client";

import Modal from "../shared/Modal";
import TicketConversation from "./TicketConversation";
import ticketsService from "../../services/ticketsService";
import { timeAgo } from "../../lib/timeAgo";
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_DOT,
} from "./ticketStatus";

// The "eye icon" dialog - used both from an order's Tickets tab and from
// the /tickets ("My tickets") page, since a ticket looks the same either
// way from the tenant side.
export default function TicketDetailDialog({ ticket, open, onClose }) {
  if (!ticket) return null;

  return (
    <Modal open={open} onClose={onClose} title={ticket.ticket_number || ticket.category}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {ticket.category}
            {ticket.sub_category ? (
              <span className="font-normal text-slate-500"> — {ticket.sub_category}</span>
            ) : null}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            {ticket.order_number ? <span>Order {ticket.order_number} ·</span> : null}
            <span title={new Date(ticket.created_at).toLocaleString()}>
              Raised {timeAgo(ticket.created_at)}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              TICKET_STATUS_TONE[ticket.status] || "bg-slate-100 text-slate-600"
            }`}
          >
            {TICKET_STATUS_LABEL[ticket.status] || ticket.status}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${TICKET_PRIORITY_DOT[ticket.priority] || "bg-slate-400"}`} />
            {TICKET_PRIORITY_LABEL[ticket.priority] || ticket.priority}
          </span>
        </div>
      </div>

      <p className="mb-4 whitespace-pre-wrap rounded-md border border-surface-border bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {ticket.description}
      </p>

      <TicketConversation
        ticketId={ticket.id}
        currentRole="tenant"
        listMessages={ticketsService.listMessages}
        createMessage={ticketsService.createMessage}
      />
    </Modal>
  );
}
