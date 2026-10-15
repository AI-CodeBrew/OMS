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
  // Load sheet already made (that's how it got here) - a re-download is
  // served from the saved copy.
  awaiting_dispatched: [PRINT_AIRWAY_BILL, PRINT_LOADSHEET],
};

export const POSTEX_DOCUMENT_ACTIONS = new Set([PRINT_AIRWAY_BILL.action, PRINT_LOADSHEET.action]);

// Books through FynkTech's own PostEx account from the store's approved
// pickup address on it (OMS Courier) - beside, not instead of, the store's
// own "Book with PostEx".
const BOOK_THROUGH_OMS = {
  key: "push_to_postex_oms",
  action: "push_to_postex_oms",
  label: "Book with PostEx (OMS Courier)",
};

// Wrap ACTIONS_BY_STATUS[status] (already wrapped with BarqRaftar's, if
// any) with this - `connected` (the store's own PostEx) and `omsConnected`
// (PostEx through OMS Courier) come from _lib/postexStatusStore.js. Either
// one brings the PostEx documents; each brings its own "Book" action.
export function withPostExActions(status, baseActions, connected, omsConnected = false) {
  if (!connected && !omsConnected) return baseActions;
  const extra = (POSTEX_ACTIONS_BY_STATUS[status] || []).filter(
    (a) => connected || a.action !== "push_to_postex"
  );
  if (omsConnected && status === "awaiting_assigning") extra.push(BOOK_THROUGH_OMS);
  return extra.length ? [...baseActions, ...extra] : baseActions;
}
