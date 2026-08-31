export const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "pending_cc", label: "Pending CC" },
  { value: "pending_cod", label: "Pending COD" },
  { value: "city_issue", label: "City Issue" },
  { value: "awaiting_assigning", label: "Awaiting Assigning" },
  { value: "awaiting_approval", label: "Awaiting Approval" },
  { value: "approved", label: "Approved" },
  { value: "booking_pending", label: "Booking Pending" },
  { value: "ready_to_print", label: "Ready to Print" },
  { value: "ready_to_pick", label: "Ready to Pick" },
  { value: "dispatch_issue", label: "Dispatch Issue" },
  { value: "awaiting_dispatched", label: "Awaiting Dispatched" },
  { value: "dispatched", label: "Dispatched" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "returned", label: "Returned" },
];

export const STATUS_LABELS = STATUS_TABS.reduce((acc, tab) => {
  acc[tab.value] = tab.label;
  return acc;
}, {});

export const SEARCH_FIELDS = [
  { value: "order_number", label: "Order Name" },
  { value: "customer_name", label: "Customer Name" },
  { value: "customer_phone", label: "Contact" },
];

// Actions that need a param OrderActionModal must collect first - the
// bulk-action endpoint returns 200 with a per-order {success:false} rather
// than an HTTP error, so calling these with no params wouldn't throw, it
// would just silently no-op. Shared between the orders page toolbar/row
// menu and the order detail panel's own action row.
export const ACTIONS_NEEDING_PARAMS = new Set([
  "assign_courier",
  "resolve_city_issue",
  "mark_dispatch_issue",
  "cancel",
  "print_loadsheet",
]);

// Smartlane generates a load sheet for one courier at a time - these are
// the picker options; "coming soon" entries mirror the CSV export
// template's existing pattern for couriers not yet enabled.
export const SMARTLANE_LOAD_SHEET_COURIERS = [
  { value: "all", label: "All" },
  { value: "leopards", label: "Leopard" },
  { value: "buraq", label: "Buraq (Coming Soon)", disabled: true },
  { value: "postex", label: "PostEx (Coming Soon)", disabled: true },
];

// Per-status, which bulk/row actions make sense - keeps OrderRowMenu and the
// Actions dropdown from offering transitions the backend would reject.
export const ACTIONS_BY_STATUS = {
  // Untouched inbox - CS picks the order up into Pending CC/COD (whichever
  // matches its gateway) before working it.
  new: [
    { action: "acknowledge", label: "Start Processing" },
    { action: "cancel", label: "Cancel" },
  ],
  pending_cc: [{ action: "confirm", label: "Confirm" }, { action: "cancel", label: "Cancel" }],
  pending_cod: [{ action: "confirm", label: "Confirm" }, { action: "cancel", label: "Cancel" }],
  city_issue: [{ action: "resolve_city_issue", label: "Resolve city issue" }, { action: "cancel", label: "Cancel" }],
  awaiting_assigning: [{ action: "assign_courier", label: "Assign courier" }, { action: "cancel", label: "Cancel" }],
  awaiting_approval: [{ action: "approve", label: "Approve" }, { action: "cancel", label: "Cancel" }],
  approved: [
    { key: "dispatch", action: "dispatch", label: "Dispatch" },
    { key: "invoice_n_dispatch", action: "dispatch", label: "Invoice N Dispatch" },
    { key: "cancel_fulfillment", action: "cancel_fulfillment", label: "Cancel Fulfillment" },
    { key: "cancel", action: "cancel", label: "Cancel" },
    { key: "invoice", action: "invoice", label: "Invoice", disabled: true },
    { key: "airway_bill", action: "airway_bill", label: "Airway Bill", disabled: true },
    { key: "sticker_invoice", action: "sticker_invoice", label: "Sticker Invoice", disabled: true },
    { key: "generate_picklist", action: "generate_picklist", label: "Generate Picklist", disabled: true },
    { key: "apply_tag", action: "apply_tag", label: "Apply Tag", disabled: true },
  ],
  awaiting_dispatched: [
    { key: "dispatch", action: "dispatch", label: "Dispatch" },
    { key: "mark_dispatch_issue", action: "mark_dispatch_issue", label: "Mark dispatch issue" },
    { key: "cancel_fulfillment", action: "cancel_fulfillment", label: "Cancel Fulfillment" },
    { key: "cancel", action: "cancel", label: "Cancel" },
  ],
  // Reached from awaiting_assigning by pushing the order to Smartlane
  // instead of assigning a manual courier - a real consignment number
  // hasn't come back from Smartlane yet (see oms.services.push_order_to_
  // smartlane), so nothing printable exists until it advances to Ready to
  // Print on its own via polling/webhook.
  // "Not booked - retry" is the way out of a push that silently failed: it
  // asks Smartlane whether the consignment exists, and only if it does not,
  // puts the stock back and returns the order to Awaiting Assigning. Without
  // it such an order is stuck here forever, since nothing advances it and
  // cancelling is terminal.
  booking_pending: [
    { key: "abandon_booking", action: "abandon_booking", label: "Not booked - retry" },
    { key: "cancel", action: "cancel", label: "Cancel" },
  ],
  // loadsheet/airway bill are handled client-side (see orders/page.jsx's
  // startAction/runAction) by fetching a printable document - Smartlane's
  // own real documents, not a plain bulk action, since they need to
  // return a document rather than mutate state. print_loadsheet needs a
  // courier param (ACTIONS_NEEDING_PARAMS) because Smartlane's load sheet
  // api is one courier per call; print_airway_bill needs none.
  ready_to_print: [
    { key: "print_loadsheet", action: "print_loadsheet", label: "Print Loadsheet" },
    { key: "print_airway_bill", action: "print_airway_bill", label: "Print Airway Bill" },
    { key: "cancel", action: "cancel", label: "Cancel" },
  ],
  ready_to_pick: [{ action: "dispatch", label: "Dispatch" }, { action: "cancel", label: "Cancel" }],
  dispatch_issue: [{ action: "retry_dispatch", label: "Retry dispatch" }, { action: "cancel", label: "Cancel" }],
  dispatched: [{ action: "mark_delivered", label: "Mark delivered" }],
  delivered: [],
  cancelled: [],
  returned: [],
};
