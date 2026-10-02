// Tells BarqRaftar the parcels are packed and ready to collect (their
// status Pending -> Awaiting Pickup). Needs no params and goes through the
// normal bulk-action endpoint (oms/views.py special-cases it), so the
// orders page / order detail panel need no extra handling for it - errors
// show up in the usual failed-orders banner.
const READY_FOR_PICKUP = {
  key: "barqraftar_ready_for_pickup",
  action: "barqraftar_ready_for_pickup",
  label: "Ready for BarqRaftar pickup",
};

// Our own Goods Load Sheet PDF for the parcels handed to BarqRaftar's
// rider (their API has no load sheet). Downloads a document rather than
// mutating anything, so - like print_barqraftar_labels - the orders page
// and order detail panel intercept it before the confirm modal.
const PRINT_LOADSHEET = {
  key: "print_barqraftar_loadsheet",
  action: "print_barqraftar_loadsheet",
  label: "Print BarqRaftar Load Sheet",
};

// BarqRaftar's own per-status action entries, kept separate from
// components/orders/statusConfig.js's ACTIONS_BY_STATUS (which stays
// untouched) so a missed call site fails closed: any component that isn't
// updated to call withBarqRaftarActions below simply never shows these,
// rather than showing them unconditionally.
export const BARQRAFTAR_ACTIONS_BY_STATUS = {
  awaiting_assigning: [
    { key: "push_to_barqraftar", action: "push_to_barqraftar", label: "Book with BarqRaftar" },
  ],
  // Appended at the end of Ready to Print's own actions (see
  // statusConfig.js's ACTIONS_BY_STATUS.ready_to_print) so the existing
  // print_loadsheet/print_airway_bill/mark_ready_to_pick/dispatch/cancel
  // order - and the 4-button quick bar on the orders page, which only
  // ever shows the first four - stays exactly as it is today.
  ready_to_print: [
    { key: "print_barqraftar_labels", action: "print_barqraftar_labels", label: "Print BarqRaftar Labels" },
    PRINT_LOADSHEET,
    READY_FOR_PICKUP,
  ],
  ready_to_pick: [PRINT_LOADSHEET, READY_FOR_PICKUP],
  // Packed and waiting for the rider - the usual moment to print the
  // handover sheet.
  awaiting_dispatched: [PRINT_LOADSHEET],
};

// Every place that renders ACTIONS_BY_STATUS[status] should wrap it with
// this instead - `connected` comes from _lib/barqraftarStatusStore.js.
export function withBarqRaftarActions(status, baseActions, connected) {
  if (!connected) return baseActions;
  const extra = BARQRAFTAR_ACTIONS_BY_STATUS[status];
  return extra ? [...baseActions, ...extra] : baseActions;
}
