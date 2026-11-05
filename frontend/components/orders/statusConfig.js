// The Orders page's cards (backend: oms.services.WORKFLOW_CARD_STATUSES) -
// each lists several statuses, so its value is "card:<name>", never a bare
// status. `tone` is OrderStatusTabs' left-edge accent stripe (blue = fresh,
// amber = needs action, indigo = moving through fulfillment, green =
// success, red = terminal/negative) - purely visual.
export const STATUS_TABS = [
  { value: "all", label: "All Orders", tone: "neutral" },
  { value: "card:awaiting_confirmation", label: "Awaiting Confirmation", tone: "blue" },
  { value: "card:approved", label: "Approved", tone: "indigo" },
  { value: "card:assigning_courier", label: "Assigning Courier", tone: "amber" },
  { value: "card:dispatched", label: "Dispatched", tone: "indigo" },
  { value: "card:undelivered", label: "Undelivered", tone: "amber" },
  { value: "card:delivered", label: "Delivered", tone: "green" },
  { value: "card:return_in_transit", label: "Return in Transit", tone: "red" },
  { value: "card:returned", label: "Returned", tone: "red" },
  { value: "card:cancelled", label: "Cancelled", tone: "red" },
];

export const ASSIGNING_COURIER_TAB = "card:assigning_courier";

// A card's tab entry by the card name an order carries (order.workflow_card).
export function cardTab(card) {
  return STATUS_TABS.find((tab) => tab.value === `card:${card}`) || null;
}

// Every status's own name - order logs, the detail header, imports. Same
// labels as the backend's Order.STATUS_CHOICES.
export const STATUS_LABELS = {
  new: "New",
  pending_cc: "Pending CC",
  pending_cod: "Pending COD",
  city_issue: "City Issue",
  awaiting_assigning: "Approved (Awaiting Courier)",
  awaiting_approval: "Awaiting Confirmation",
  approved: "Approved",
  booking_pending: "Awaiting Booking",
  ready_to_print: "Ready to Print",
  ready_to_pick: "Ready to Pick",
  dispatch_issue: "Dispatch Issue",
  awaiting_dispatched: "Awaiting Dispatched",
  dispatched: "Dispatched",
  out_for_delivery: "Out for Delivery",
  attempt: "Delivery Attempt Failed",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
  // Not a status - Critical Orders has its own page.
  critical: "Critical Orders",
};

// Cancel Order's reasons - one has to be picked.
export const CANCEL_REASONS = ["Customer Cancelled", "On Seller Request", "Order Price Issue", "Fake/Test Order"];

// Same lists as the backend's QUEUE_COURIER_STATUSES /
// AWAITING_PICKUP_COURIER_STATUSES (oms/services.py) - the courier's own
// word, the Sub Status, compared case-insensitively. Booking Pending also
// lists booked orders the courier calls queue / Unbooked / Pending, and
// Awaiting Dispatched those it calls Awaiting Pickup / Booked / ready
// besides every order whose load sheet is made; both kinds stay in Ready to
// Print too until their load sheet is made (backend:
// oms.services.booking_pending_orders / awaiting_dispatch_orders). No
// longer tabs, but a dashboard or old link can still open them.
const ON_SHELF_STATUSES = new Set(["ready_to_print", "ready_to_pick"]);
const QUEUE_COURIER_STATUSES = new Set(["queue", "queued", "unbooked", "pending"]);
const AWAITING_PICKUP_COURIER_STATUSES = new Set(["awaiting pickup", "awaiting_pickup", "booked", "ready"]);

// Whether `order` belongs on tab `tab` - the client-side twin of the
// backend's tab filter, for patching live updates in. "critical" is
// time-dependent and handled by the orders page itself.
export function orderInTab(order, tab) {
  if (tab === "all") return true;
  // A card: the backend says which one the order is under.
  if (tab.startsWith("card:")) return `card:${order.workflow_card}` === tab;
  // A dashboard card opens several statuses at once ("pending_cc,city_issue,...").
  if (tab.includes(",")) return tab.split(",").includes(order.status);
  const courierStatus = (order.courier_status || "").trim().toLowerCase();
  const onShelf = ON_SHELF_STATUSES.has(order.status);
  if (tab === "new") return order.status === "new" || order.status === "awaiting_approval";
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

// Awaiting Confirmation only - its details and line items can be edited.
// From Approved on, an order is locked (Assigning Courier's Edit Order
// cancels the booking and brings it back here first).
export const EDITABLE_STATUSES = new Set([
  "new",
  "pending_cc",
  "pending_cod",
  "city_issue",
  "awaiting_approval",
]);

// Approved or later - no Edit at all (backend: oms.services.
// EDIT_LOCKED_STATUSES).
export const EDIT_LOCKED_STATUSES = new Set([
  "awaiting_assigning",
  "approved",
  "booking_pending",
  "ready_to_print",
  "ready_to_pick",
  "awaiting_dispatched",
  "dispatch_issue",
  "dispatched",
  "out_for_delivery",
  "attempt",
  "delivered",
  "returned",
  "cancelled",
]);

// Assigning Courier's own three, offered first for any selection that is
// all in that card (whatever each order's own status there) - the orders
// page puts the statuses' print/load-sheet actions after them.
// The ONE tag an order shows - the latest: in Awaiting Confirmation its own
// tag (a revert reason, Cancelled from Courier Booking, Update Tag, ...) is
// newer than the card's default (New); from Approved on, the stage's tag
// (To Be Packed, Stock Not Available, ...) is. Either falls back to the
// other. Returns { text, own } - own: the order's own tag.
export function latestTag(order) {
  if (order.tag && (order.workflow_card === "awaiting_confirmation" || !order.workflow_tag)) {
    return { text: order.tag, own: true };
  }
  return order.workflow_tag ? { text: order.workflow_tag, own: false } : null;
}

// "edit_order" is Cancel Booking: the booking is cancelled and the order
// goes back to Awaiting Confirmation (backend: oms.services.unbook_for_edit).
export const ASSIGNING_COURIER_ACTIONS = [
  { key: "cancel", action: "cancel", label: "Cancel Order" },
  { key: "change_courier", action: "change_courier", label: "Change Courier" },
  { key: "edit_order", action: "edit_order", label: "Cancel Booking" },
];

// Assigning Courier's two prints, the same for the Hub and a store - each
// covers every courier (the Hub's courier by courier in one PDF, a store's
// through PrintByCourierModal).
export const ASSIGNING_PRINT_ACTIONS = [
  { key: "print_loadsheet", action: "print_loadsheet", label: "Print Loadsheet" },
  { key: "print_airway_bill", action: "print_airway_bill", label: "Print Airway Bill" },
];

// Per-status, which bulk/row actions make sense - keeps OrderRowMenu and the
// Actions dropdown from offering transitions the backend would reject.
export const REVERT_ACTION = { action: "revert_status", label: "Revert to previous status" };

const REVERT_TO_CONFIRMATION = { action: "revert_to_confirmation", label: "Revert to Awaiting Confirmation" };

// Every way of booking an Approved order with a courier - the store's own
// accounts, OMS Courier's, Auto Book, and Assign courier (Smartlane / OMS
// Courier through its own picker).
const BOOKING_CHOICE_ACTIONS = new Set([
  "auto_book",
  "push_to_barqraftar",
  "push_to_barqraftar_oms",
  "push_to_postex",
  "push_to_postex_oms",
  "push_to_leopards",
  "push_to_leopards_oms",
  "assign_courier",
]);

export const MOVE_TO_ASSIGNING = "move_to_assigning";

// Folds an action list's booking actions (after the BarqRaftar / PostEx
// wrappers added theirs) into one "Move to Assigning Courier", whose
// `choices` are the bookings it can run - its popup asks which.
export function withMoveToAssigning(actions) {
  const choices = actions.filter((a) => BOOKING_CHOICE_ACTIONS.has(a.action));
  if (!choices.length) return actions;
  return [
    {
      key: MOVE_TO_ASSIGNING,
      action: MOVE_TO_ASSIGNING,
      label: "Move to Assigning Courier",
      choices: choices.map((a) => ({
        value: a.action,
        label: a.action === "assign_courier" ? "Smartlane / OMS Courier" : a.label.replace(/^Book with /, ""),
      })),
    },
    ...actions.filter((a) => !BOOKING_CHOICE_ACTIONS.has(a.action)),
  ];
}

// Every status in the Awaiting Confirmation card gets the same three:
// Approve (checks the order, then Approved - or City Issue when only the
// city is wrong; a City Issue order is fixed with Edit, then Approve),
// Update Tag and Cancel. Raise ticket sits beside them in both menus.
const AWAITING_CONFIRMATION_ACTIONS = [
  { action: "acknowledge", label: "Approve" },
  { action: "update_tag", label: "Update Tag" },
  { action: "cancel", label: "Cancel Order" },
];

export const ACTIONS_BY_STATUS = {
  new: AWAITING_CONFIRMATION_ACTIONS,
  pending_cc: AWAITING_CONFIRMATION_ACTIONS,
  pending_cod: AWAITING_CONFIRMATION_ACTIONS,
  city_issue: AWAITING_CONFIRMATION_ACTIONS,
  awaiting_approval: AWAITING_CONFIRMATION_ACTIONS,
  // The Approved card: book a courier (withMoveToAssigning folds every
  // booking action into one Move to Assigning Courier, which asks which),
  // or back to Awaiting Confirmation with a tag saying why (backend:
  // oms.services.revert_to_awaiting_confirmation). An order in plain
  // Approved (shipped without booking) can only be sent back.
  // Self Deliver: the store ships it itself - on to Self Delivered.
  awaiting_assigning: [
    { action: "assign_courier", label: "Assign courier" },
    { action: "self_deliver", label: "Self Deliver" },
    REVERT_TO_CONFIRMATION,
  ],
  approved: [REVERT_TO_CONFIRMATION],
  // Handed to the courier (its load sheet made, or the courier reports it
  // Booked / Awaiting Pickup) and waiting for the rider. The documents stay
  // on offer here for a re-print - the Batch page keeps every one as well.
  awaiting_dispatched: [
    { key: "dispatch", action: "dispatch", label: "Dispatch" },
    { key: "print_loadsheet", action: "print_loadsheet", label: "Print Loadsheet" },
    { key: "print_airway_bill", action: "print_airway_bill", label: "Print Airway Bill" },
    { key: "mark_dispatch_issue", action: "mark_dispatch_issue", label: "Mark dispatch issue" },
    { key: "cancel_fulfillment", action: "cancel_fulfillment", label: "Cancel Fulfillment" },
    { key: "cancel", action: "cancel", label: "Cancel Order" },
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
    { key: "cancel", action: "cancel", label: "Cancel Order" },
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
    { key: "cancel", action: "cancel", label: "Cancel Order" },
  ],
  ready_to_pick: [
    { key: "queue_for_dispatch", action: "queue_for_dispatch", label: "Awaiting Dispatching" },
    { key: "cancel", action: "cancel", label: "Cancel Order" },
  ],
  dispatch_issue: [{ action: "retry_dispatch", label: "Retry dispatch" }, { action: "cancel", label: "Cancel Order" }],
  // No Mark delivered after Approved - delivery comes from the courier.
  dispatched: [],
  out_for_delivery: [],
  // Undelivered: tell the courier Reattempt or Return (Shipper Advice).
  attempt: [{ action: "shipper_advice", label: "Shipper Advice" }],
  delivered: [],
  cancelled: [],
  returned: [],
};
