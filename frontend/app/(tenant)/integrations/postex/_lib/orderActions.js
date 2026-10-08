// PostEx's own per-status order actions, kept out of
// components/orders/statusConfig.js (same reasoning as BarqRaftar's
// orderActions.js): a call site that isn't wrapped with withPostExActions
// simply never shows them.

// Both return a document rather than mutating anything, so the orders page
// and order detail panel intercept them before the confirm modal.
const PRINT_AIRWAY_BILL = {
  key: "print_postex_airway_bill",
  action: "print_postex_airway_bill",
  label: "Print PostEx Airway Bill",
};

const PRINT_LOADSHEET = {
  key: "print_postex_loadsheet",
  action: "print_postex_loadsheet",
  label: "Print PostEx Load Sheet",
};

export const POSTEX_ACTIONS_BY_STATUS = {
  awaiting_assigning: [{ key: "push_to_postex", action: "push_to_postex", label: "Book with PostEx" }],
  ready_to_print: [PRINT_AIRWAY_BILL, PRINT_LOADSHEET],
  ready_to_pick: [PRINT_AIRWAY_BILL, PRINT_LOADSHEET],
  awaiting_dispatched: [PRINT_LOADSHEET],
};

export const POSTEX_DOCUMENT_ACTIONS = new Set([PRINT_AIRWAY_BILL.action, PRINT_LOADSHEET.action]);

// Wrap ACTIONS_BY_STATUS[status] (already wrapped with BarqRaftar's, if
// any) with this - `connected` comes from _lib/postexStatusStore.js.
export function withPostExActions(status, baseActions, connected) {
  if (!connected) return baseActions;
  const extra = POSTEX_ACTIONS_BY_STATUS[status];
  return extra ? [...baseActions, ...extra] : baseActions;
}
