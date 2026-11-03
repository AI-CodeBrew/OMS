// Leopards' own per-status order actions, kept out of
// components/orders/statusConfig.js (same reasoning as PostEx's
// orderActions.js): a call site that isn't wrapped with withLeopardsActions
// simply never shows them.

// Both return a document rather than mutating anything, so the orders page
// and order detail panel intercept them before the confirm modal.
const PRINT_AIRWAY_BILL = {
  key: "print_leopards_airway_bill",
  action: "print_leopards_airway_bill",
  label: "Print Leopards Airway Bill",
};

const PRINT_LOADSHEET = {
  key: "print_leopards_loadsheet",
  action: "print_leopards_loadsheet",
  label: "Print Leopards Load Sheet",
};

export const LEOPARDS_ACTIONS_BY_STATUS = {
  awaiting_assigning: [{ key: "push_to_leopards", action: "push_to_leopards", label: "Book with Leopards" }],
  ready_to_print: [PRINT_AIRWAY_BILL, PRINT_LOADSHEET],
  ready_to_pick: [PRINT_AIRWAY_BILL, PRINT_LOADSHEET],
  // Load sheet already made (that's how it got here) - a re-download is
  // fetched again by its load sheet id.
  awaiting_dispatched: [PRINT_AIRWAY_BILL, PRINT_LOADSHEET],
};

export const LEOPARDS_DOCUMENT_ACTIONS = new Set([PRINT_AIRWAY_BILL.action, PRINT_LOADSHEET.action]);

// Books through FynkTech's own Leopards account under the store's approved
// shipper on it (OMS Courier) - beside, not instead of, the store's own
// "Book with Leopards".
const BOOK_THROUGH_OMS = {
  key: "push_to_leopards_oms",
  action: "push_to_leopards_oms",
  label: "Book with Leopards (OMS Courier)",
};

// Wrap ACTIONS_BY_STATUS[status] (already wrapped with the other couriers')
// with this - `connected` (the store's own Leopards) and `omsConnected`
// (Leopards through OMS Courier) come from _lib/leopardsStatusStore.js.
// Either one brings the Leopards documents; each brings its own "Book"
// action.
export function withLeopardsActions(status, baseActions, connected, omsConnected = false) {
  if (!connected && !omsConnected) return baseActions;
  const extra = (LEOPARDS_ACTIONS_BY_STATUS[status] || []).filter(
    (a) => connected || a.action !== "push_to_leopards"
  );
  if (omsConnected && status === "awaiting_assigning") extra.push(BOOK_THROUGH_OMS);
  return extra.length ? [...baseActions, ...extra] : baseActions;
}
