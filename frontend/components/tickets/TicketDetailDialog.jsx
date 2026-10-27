"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import TicketConversation from "./TicketConversation";
import { InfoCard } from "./TicketInfoCards";
import ticketsService from "../../services/ticketsService";

function HistoryIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M3 10a7 7 0 1 0 2.05-4.95" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 4v3h3M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The ticket popup (store side) - from the Tickets page and an order's
// Tickets tab, since a ticket looks the same either way. A coloured header
// with the ticket number, its description, then its history
// (the conversation with FynkTech) and a Close at the bottom.
export default function TicketDetailDialog({ ticket, open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!ticket || !open || typeof document === "undefined") return null;

  // Portalled to <body>: rendered inside the page, the app's sticky top
  // bar sat over the popup's header and hid the ticket number.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between bg-gradient-to-r from-brand-900 to-brand-600 px-5 py-4 text-white">
          <h2 className="text-base font-semibold">Ticket {ticket.ticket_number}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Just what the ticket says - its number is in the header and
              its status, type, order etc. are on the Tickets list's row. */}
          <InfoCard label="Description">
            <p className="whitespace-pre-wrap">{ticket.description}</p>
          </InfoCard>

          <h3 className="mb-3 mt-6 flex items-center gap-2 border-b border-surface-border pb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
            <HistoryIcon />
            Ticket History
          </h3>
          <TicketConversation
            ticketId={ticket.id}
            currentRole="tenant"
            listMessages={ticketsService.listMessages}
            createMessage={ticketsService.createMessage}
          />
        </div>

        <div className="flex justify-end border-t border-surface-border bg-white px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-500 px-5 py-2 text-sm font-medium text-white hover:bg-slate-600"
          >
            ✕ Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
