// Shared by every ticket list/detail view (tenant + admin) so a status or
// priority never renders with a different label/color depending on which
// screen you're looking at it from.
export const TICKET_STATUS_LABEL = {
  open: "Open",
  seen: "Seen",
  in_progress: "In Progress",
  resolved: "Resolved",
};

export const TICKET_STATUS_TONE = {
  open: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  seen: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  in_progress: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
};

export const TICKET_PRIORITY_LABEL = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Distinct from status tone (rings vs solid dot) so the two badges never
// get confused for one another at a glance in a dense list row.
export const TICKET_PRIORITY_TONE = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-sky-50 text-sky-700",
  high: "bg-orange-50 text-orange-700",
  urgent: "bg-red-50 text-red-700",
};

export const TICKET_PRIORITY_DOT = {
  low: "bg-slate-400",
  medium: "bg-sky-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

export const TICKET_STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "seen", label: "Seen" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
];

export const TICKET_PRIORITY_FILTERS = [
  { value: "", label: "All priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
