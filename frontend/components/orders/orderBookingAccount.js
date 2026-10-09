// Every booking integration books an order under a Courier row of its own
// name - Smartlane's two accounts under SmartlaneConnection.COURIER_NAMES,
// BarqRaftar and PostEx under "BarqRaftar"/"PostEx" (their services' own
// get-or-create) - so an order's courier_name is how it remembers which
// one it went out through. The backend goes by the same thing when
// printing (SmartlaneConnection.for_order, the BarqRaftar/PostEx bookings).
const ACCOUNT_BY_COURIER_NAME = {
  smartlane: "smartlane",
  "oms courier": "oms_courier",
  barqraftar: "barqraftar",
  postex: "postex",
};

export const BOOKING_ACCOUNT_LABELS = {
  smartlane: "Smartlane",
  oms_courier: "OMS Courier",
  barqraftar: "BarqRaftar",
  postex: "PostEx",
};

export const SMARTLANE_ACCOUNTS = new Set(["smartlane", "oms_courier"]);

// "smartlane" | "oms_courier" | "barqraftar" | "postex", or null for an
// order with no courier yet, or one no integration booked (a manually
// assigned or imported courier).
export function orderBookingAccount(order) {
  return ACCOUNT_BY_COURIER_NAME[(order?.courier_name || "").trim().toLowerCase()] || null;
}

// Actions that only work for an order booked through particular accounts -
// Smartlane's documents serve both of its accounts. Anything not listed
// (Ready to Pick, Dispatch, Cancel, "Book with ...", ...) suits any order.
const ACCOUNTS_BY_ACTION = {
  print_loadsheet: ["smartlane", "oms_courier"],
  print_airway_bill: ["smartlane", "oms_courier"],
  print_barqraftar_labels: ["barqraftar"],
  print_barqraftar_loadsheet: ["barqraftar"],
  barqraftar_ready_for_pickup: ["barqraftar"],
  print_postex_airway_bill: ["postex"],
  print_postex_loadsheet: ["postex"],
};

// Drops the courier-specific actions of every account none of `orders` was
// booked through, so a Smartlane order isn't offered BarqRaftar's labels or
// PostEx's load sheet. If any order's account can't be told (see
// orderBookingAccount) nothing is dropped - the same list it got before
// this filter existed. `alwaysKeep` names actions to leave in regardless.
export function forOrdersBookingAccounts(actions, orders, alwaysKeep = []) {
  const accounts = new Set();
  for (const order of orders) {
    const account = orderBookingAccount(order);
    if (!account) return actions;
    accounts.add(account);
  }
  return actions.filter((a) => {
    const owners = ACCOUNTS_BY_ACTION[a.action];
    return !owners || alwaysKeep.includes(a.action) || owners.some((o) => accounts.has(o));
  });
}
