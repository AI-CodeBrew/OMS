// Shared by every ticket list/detail view (tenant + admin) so a status or
// type never renders with a different label/color depending on which
// screen you're looking at it from.
export const TICKET_STATUS_LABEL = {
  open: "Open",
  pending: "Pending",
  in_progress: "In Progress",
  awaiting_action: "Awaiting Action",
  resolved: "Resolved",
};

// The order a ticket moves through - the admin's status actions offer
// these in this order.
export const TICKET_STATUSES = Object.keys(TICKET_STATUS_LABEL);

export const TICKET_STATUS_TONE = {
  open: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  pending: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  in_progress: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  awaiting_action: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
};

// Who raised a ticket - set by the backend, never chosen: "customer" is a
// store (FynkTech's client on OMS), "admin" is FynkTech's super admin side.
export const TICKET_TYPE_LABEL = {
  customer: "By Customer",
  admin: "By Admin",
};

// Matches TicketSerializer.DESCRIPTION_MIN_CHARS - spaces don't count.
export const DESCRIPTION_MIN_CHARS = 10;

export function descriptionLength(text) {
  return (text || "").replace(/\s/g, "").length;
}

export function TicketTypeBadge({ type }) {
  if (!type) return null;
  return (
    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {TICKET_TYPE_LABEL[type] || type}
    </span>
  );
}
