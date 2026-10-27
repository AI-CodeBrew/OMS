"use client";

import { useEffect, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import { CANCEL_REASONS, SMARTLANE_LOAD_SHEET_COURIERS } from "./statusConfig";
import ordersService from "../../services/ordersService";

const FIELD_BY_ACTION = {
  assign_courier: { key: "courier_id", label: "Courier", type: "courier-select" },
  // Suggests the couriers' city list - only those spellings pass.
  resolve_city_issue: { key: "city", label: "Corrected city", type: "city-input" },
  mark_dispatch_issue: { key: "note", label: "Issue note", type: "text" },
  // One of CANCEL_REASONS has to be picked.
  cancel: { key: "reason", label: "Cancellation reason", type: "reason-select" },
  // `options` (the couriers this store can book with) comes from the page.
  change_courier: { key: "courier", label: "New courier", type: "option-select" },
  print_loadsheet: { key: "courier", label: "Courier", type: "smartlane-courier-select" },
};

const ACTION_TITLES = {
  assign_courier: "Assign courier",
  resolve_city_issue: "Resolve city issue",
  mark_dispatch_issue: "Mark dispatch issue",
  cancel: "Cancel order(s)",
  change_courier: "Change courier",
  print_loadsheet: "Print Load Sheet",
};

// Actions that need no input still get this popup, as a confirm step:
// `result` finishes "N orders will ...". Anything not listed falls back
// to a generic message, so a new action is never run unconfirmed.
const CONFIRM_BY_ACTION = {
  acknowledge: {
    title: "Approve order(s)",
    button: "Approve",
    result:
      "be checked and move to Approved, ready for a courier - an order whose city isn't on the couriers' city list moves to City Issue instead",
  },
  // Assigning Courier's Edit Order (backend: oms.services.unbook_from_assigning).
  edit_order: {
    title: "Edit order(s)",
    button: "Cancel Booking & Edit",
    result:
      "have their courier booking cancelled and move back to Approved, tagged Cancelled from Assigning Courier, to be edited",
  },
  confirm: { title: "Confirm order(s)", button: "Confirm", result: "move to Assigning Courier" },
  revert_status: {
    title: "Revert to previous status",
    button: "Revert",
    result: "go back to the status they were in before this one",
  },
  approve: { title: "Approve order(s)", button: "Approve", result: "move to Approved" },
  dispatch: { title: "Dispatch order(s)", button: "Dispatch", result: "be marked Dispatched" },
  cancel_fulfillment: {
    title: "Cancel fulfillment",
    button: "Cancel Fulfillment",
    result: "be marked unfulfilled - the order status doesn't change",
  },
  abandon_booking: {
    title: "Not booked - retry",
    button: "Retry",
    result:
      "be checked with Smartlane, and go back to Assigning Courier if the booking doesn't exist there",
  },
  mark_ready_to_pick: { title: "Ready to Pick", button: "Ready to Pick", result: "move to Ready to Pick" },
  queue_for_dispatch: {
    title: "Awaiting Dispatching",
    button: "Move",
    result: "move to Awaiting Dispatched",
  },
  retry_dispatch: {
    title: "Retry dispatch",
    button: "Retry",
    result: "move back to Awaiting Dispatched",
  },
  mark_delivered: { title: "Mark delivered", button: "Mark Delivered", result: "be marked Delivered" },
  // New orders handled outside OMS - straight to the outcome, no booking
  // and no stock taken (oms.services.set_outcome_by_hand).
  mark_delivered_by_hand: {
    title: "Mark delivered",
    button: "Mark Delivered",
    result: "move from New straight to Delivered (no courier booking, no stock taken)",
  },
  mark_returned_by_hand: {
    title: "Mark returned",
    button: "Mark Returned",
    result: "move from New straight to Returned (no courier booking, no stock taken)",
  },
  mark_dispatched_by_hand: {
    title: "Mark dispatched",
    button: "Mark Dispatched",
    result: "move from New straight to Dispatched (no courier booking, no stock taken)",
  },
  auto_book: {
    title: "Auto Book",
    button: "Book",
    result:
      "be booked with BarqRaftar if their city is spelled exactly as one of BarqRaftar's, else with PostEx if spelled exactly as one of PostEx's - any other stays here, tagged No City Matched",
  },
  push_to_barqraftar: {
    title: "Book with BarqRaftar",
    button: "Book",
    result: "be booked with BarqRaftar",
  },
  barqraftar_ready_for_pickup: {
    title: "Ready for BarqRaftar pickup",
    button: "Confirm",
    result: "be marked ready for BarqRaftar to collect",
  },
  push_to_postex: {
    title: "Book with PostEx",
    button: "Book",
    result: "be booked with PostEx",
  },
  push_to_barqraftar_oms: {
    title: "Book with BarqRaftar (OMS Courier)",
    button: "Book",
    result: "be booked with BarqRaftar through FynkTech's account, from your pickup address",
  },
  push_to_postex_oms: {
    title: "Book with PostEx (OMS Courier)",
    button: "Book",
    result: "be booked with PostEx through FynkTech's account, from your pickup address",
  },
};

export default function OrderActionModal({ action, couriers, options, count, onSubmit, onClose, submitting }) {
  const field = action ? FIELD_BY_ACTION[action] : null;
  const [value, setValue] = useState("");
  const [cityNames, setCityNames] = useState([]);

  useEffect(() => {
    setValue("");
  }, [action]);

  useEffect(() => {
    if (field?.type !== "city-input") return;
    let alive = true;
    ordersService
      .getCityNames()
      .then((names) => alive && setCityNames(names))
      .catch(() => alive && setCityNames([]));
    return () => {
      alive = false;
    };
  }, [field?.type]);

  if (!action) return null;

  const orders = `${count} order${count === 1 ? "" : "s"}`;

  if (!field) {
    const confirm = CONFIRM_BY_ACTION[action] || {
      title: action.replace(/_/g, " "),
      button: "Confirm",
      result: "be updated",
    };
    return (
      <Modal open title={confirm.title} onClose={onClose}>
        <p className="text-sm text-slate-700">
          {orders} will {confirm.result}. Continue?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={submitting} onClick={() => onSubmit({})}>
            {confirm.button}
          </Button>
        </div>
      </Modal>
    );
  }

  const canSubmit = field.optional || value.trim().length > 0;

  return (
    <Modal open title={ACTION_TITLES[action] || action} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">Applying to {orders}.</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">{field.label}</span>
        {field.type === "courier-select" ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Select a courier…</option>
            {(couriers || []).map((c) => (
              <option key={c.id} value={c.id} disabled={c.disabled}>
                {c.name}
              </option>
            ))}
          </select>
        ) : field.type === "reason-select" ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Select a reason…</option>
            {CANCEL_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        ) : field.type === "option-select" ? (
          <>
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">Select a courier…</option>
              {(options || []).map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              The current booking is cancelled first, then the order is booked with this courier. If the new
              booking fails, the order goes back to Approved with no tracking number.
            </p>
          </>
        ) : field.type === "smartlane-courier-select" ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Select a courier…</option>
            {SMARTLANE_LOAD_SHEET_COURIERS.map((c) => (
              <option key={c.value} value={c.value} disabled={c.disabled}>
                {c.label}
              </option>
            ))}
          </select>
        ) : field.type === "city-input" ? (
          <>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              list="courier-city-names"
              placeholder="Start typing a city…"
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <datalist id="courier-city-names">
              {cityNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <p className="mt-2 text-xs text-slate-500">
              Pick the city as the couriers spell it - the order then moves to Approved.
            </p>
          </>
        ) : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        )}
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit}
          loading={submitting}
          onClick={() => onSubmit({ [field.key]: value })}
        >
          Apply
        </Button>
      </div>
    </Modal>
  );
}
