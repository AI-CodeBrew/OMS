// `tone` groups each status into a category for OrderStatusTabs' left-edge
// accent stripe (blue = fresh/queue, amber = needs action, indigo = moving
// through fulfillment, green = success, red = terminal/negative) - purely
// visual, doesn't affect filtering/routing.
export const STATUS_TABS = [
  { value: "all", label: "All", tone: "neutral" },
  { value: "new", label: "New", tone: "blue" },
  { value: "awaiting_approval", label: "Awaiting Approval", tone: "amber" },
  { value: "city_issue", label: "City Issue", tone: "amber" },
  { value: "approved", label: "Approved", tone: "indigo" },
  { value: "awaiting_assigning", label: "Awaiting Assigning", tone: "amber" },
  { value: "booking_pending", label: "Booking Pending", tone: "amber" },
  { value: "ready_to_print", label: "Ready to Print", tone: "indigo" },
  { value: "ready_to_pick", label: "Ready to Pick", tone: "indigo" },
  // Booking Pending and Awaiting Dispatched also list booked orders by what
  // the courier calls them - see orderInTab below.
  { value: "awaiting_dispatched", label: "Awaiting Dispatched", tone: "indigo" },
  { value: "dispatched", label: "Dispatched", tone: "indigo" },
  // Not a real status: Dispatched (courier "In Transit") orders that have
  // been there for more than 3 days (backend: oms.services.
  // critical_transit_orders) - they stay in Dispatched too. Computed fresh,
  // so it is never cached - see orders/page.jsx.
  { value: "critical", label: "Critical Orders", tone: "red" },
  { value: "out_for_delivery", label: "Out for Delivery", tone: "indigo" },
  { value: "attempt", label: "Delivery Attempt Failed", tone: "amber" },
  { value: "cancelled", label: "Cancelled", tone: "red" },
  { value: "returned", label: "Returned", tone: "red" },
  { value: "delivered", label: "Delivered", tone: "green" },
];

export const STATUS_LABELS = STATUS_TABS.reduce(
  (acc, tab) => {
    acc[tab.value] = tab.label;
    return acc;
  },
  // No longer tabs - nothing new enters them (New goes straight to Awaiting
  // Assigning) - but orders already there, and order logs that mention
  // them, still need their names.
  { pending_cc: "Pending CC", pending_cod: "Pending COD" }
);

// Same lists as the backend's QUEUE_COURIER_STATUSES /
// AWAITING_PICKUP_COURIER_STATUSES (oms/services.py) - the courier's own
// word, the Sub Status, compared case-insensitively. Booking Pending also
// lists booked orders the courier calls queue / Unbooked / Pending, and
// Awaiting Dispatched those it calls Awaiting Pickup / Booked / ready
// besides every order whose load sheet is made; both kinds stay in Ready to
// Print too until their load sheet is made (backend:
// oms.services.booking_pending_orders / awaiting_dispatch_orders).
const ON_SHELF_STATUSES = new Set(["ready_to_print", "ready_to_pick"]);
const QUEUE_COURIER_STATUSES = new Set(["queue", "queued", "unbooked", "pending"]);
const AWAITING_PICKUP_COURIER_STATUSES = new Set(["awaiting pickup", "awaiting_pickup", "booked", "ready"]);

// Whether `order` belongs on status tab `tab` - the client-side twin of the
// backend's tab filter, for patching live updates in. "critical" is
// time-dependent and handled by the orders page itself.
export function orderInTab(order, tab) {
  if (tab === "all") return true;
  // A dashboard card opens several statuses at once ("pending_cc,city_issue,...").
  if (tab.includes(",")) return tab.split(",").includes(order.status);
  const courierStatus = (order.courier_status || "").trim().toLowerCase();
  const onShelf = ON_SHELF_STATUSES.has(order.status);
  if (tab === "booking_pending") {
    return order.status === "booking_pending" || (onShelf && QUEUE_COURIER_STATUSES.has(courierStatus));
  }
  if (tab === "awaiting_dispatched") {
    return (
      order.status === "awaiting_dispatched" || (onShelf && AWAITING_PICKUP_COURIER_STATUSES.has(courierStatus))
    );
  }
  return order.status === tab;
}

export const SEARCH_FIELDS = [
  { value: "order_number", label: "Order Name" },
  { value: "customer_name", label: "Customer Name" },
  { value: "customer_phone", label: "Contact" },
  { value: "product_name", label: "Product Name" },
];

// Smartlane generates a load sheet for one courier at a time - these are
// the picker options; "coming soon" entries mirror the CSV export
// template's existing pattern for couriers not yet enabled. Leopards and
// BarqRaftar are both confirmed live (real orders auto-routed to each,
// airway bills render correctly for both) - keep this in sync with
// smartlane_client.SUPPORTED_COURIERS on the backend, which enforces the
// same set server-side. BarqRaftar's slug is "barq_raftar" (with the
// underscore) - confirmed with Smartlane after "barqraftar" (and before
// that "buraq") both turned out to be wrong guesses.
export const SMARTLANE_LOAD_SHEET_COURIERS = [
  { value: "all", label: "All" },
  { value: "leopards", label: "Leopard" },
  { value: "barq_raftar", label: "BarqRaftar" },
  { value: "postex", label: "PostEx (Coming Soon)", disabled: true },
];

// Synthetic entries in the "Assign courier" picker that book through a
// Smartlane account (push_to_smartlane) rather than assign a Courier row by
// hand. `account` is the backend's SmartlaneConnection kind; `name` is also
// the Courier row such a booking creates (SmartlaneConnection.COURIER_NAMES),
// so rows with these names are kept out of the manual list.
export const BOOKING_ACCOUNTS = [
  { id: "smartlane", name: "Smartlane", account: "own" },
  { id: "oms_courier", name: "OMS Courier", account: "oms" },
];

const BOOKING_ACCOUNT_NAMES = new Set(BOOKING_ACCOUNTS.map((a) => a.name.toLowerCase()));

export function isBookingAccountCourier(courier) {
  return BOOKING_ACCOUNT_NAMES.has((courier?.name || "").trim().toLowerCase());
}

// The booking accounts this org can actually book through right now.
export function connectedBookingAccounts({ smartlaneConnected, omsCourierConnected }) {
  return BOOKING_ACCOUNTS.filter((a) =>
    a.account === "oms" ? omsCourierConnected : smartlaneConnected
  );
}

// New through Awaiting Assigning - no courier on the order yet, so its
// details and line items can still be edited. Stock isn't deducted until
// the order is pushed to a courier (wms.services.consume_for_order), so
// changing items here doesn't leave the ledger out of step.
export const EDITABLE_STATUSES = new Set([
  "new",
  "pending_cc",
  "pending_cod",
  "city_issue",
  "awaiting_assigning",
]);

// Per-status, which bulk/row actions make sense - keeps OrderRowMenu and the
// Actions dropdown from offering transitions the backend would reject.
export const ACTIONS_BY_STATUS = {
  // Untouched inbox - CS picks the order up into Pending CC/COD (whichever
  // matches its gateway) before working it. An order already handled
  // outside OMS can instead be marked straight to its outcome (backend:
  // oms.services.set_outcome_by_hand).
  new: [
    { action: "acknowledge", label: "Start Processing" },
    { action: "mark_dispatched_by_hand", label: "Mark Dispatched" },
    { action: "mark_delivered_by_hand", label: "Mark Delivered" },
    { action: "mark_returned_by_hand", label: "Mark Returned" },
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
    { key: "invoice", action: "invoice", label: "Invoice", disabled: true },
    { key: "airway_bill", action: "airway_bill", label: "Airway Bill", disabled: true },
    { key: "sticker_invoice", action: "sticker_invoice", label: "Sticker Invoice", disabled: true },
    { key: "generate_picklist", action: "generate_picklist", label: "Generate Picklist", disabled: true },
    { key: "apply_tag", action: "apply_tag", label: "Apply Tag", disabled: true },
    { key: "cancel_fulfillment", action: "cancel_fulfillment", label: "Cancel Fulfillment" },
    { key: "cancel", action: "cancel", label: "Cancel" },
  ],
  // Handed to the courier (its load sheet made, or the courier reports it
  // Booked / Awaiting Pickup) and waiting for the rider. The documents stay
  // on offer here for a re-print - the Batch page keeps every one as well.
  awaiting_dispatched: [
    { key: "dispatch", action: "dispatch", label: "Dispatch" },
    { key: "print_loadsheet", action: "print_loadsheet", label: "Print Loadsheet" },
    { key: "print_airway_bill", action: "print_airway_bill", label: "Print Airway Bill" },
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
  // courier param (OrderActionModal's FIELD_BY_ACTION) because Smartlane's load sheet
  // api is one courier per call; print_airway_bill needs none.
  // Manual Dispatch/Ready to Pick are both fallbacks for when the courier
  // hasn't reported real progress yet. An order stays here (visibly
  // "Ready to Print") through as many airway-bill downloads as needed;
  // generating its load sheet hands it over and moves it on to Awaiting
  // Dispatched (backend: oms.services.mark_handed_over).
  ready_to_print: [
    { key: "print_loadsheet", action: "print_loadsheet", label: "Print Loadsheet" },
    { key: "print_airway_bill", action: "print_airway_bill", label: "Print Airway Bill" },
    { key: "mark_ready_to_pick", action: "mark_ready_to_pick", label: "Ready to Pick" },
    { key: "dispatch", action: "dispatch", label: "Dispatch" },
    { key: "cancel", action: "cancel", label: "Cancel" },
  ],
  ready_to_pick: [
    { key: "queue_for_dispatch", action: "queue_for_dispatch", label: "Awaiting Dispatching" },
    { key: "cancel", action: "cancel", label: "Cancel" },
  ],
  dispatch_issue: [{ action: "retry_dispatch", label: "Retry dispatch" }, { action: "cancel", label: "Cancel" }],
  dispatched: [{ action: "mark_delivered", label: "Mark delivered" }],
  // Smartlane-reported sub-stages of dispatched - same manual fallback
  // available, since staff may need to mark delivered by hand regardless
  // of which sub-stage the courier last reported.
  out_for_delivery: [{ action: "mark_delivered", label: "Mark delivered" }],
  attempt: [{ action: "mark_delivered", label: "Mark delivered" }],
  delivered: [],
  cancelled: [],
  returned: [],
};
