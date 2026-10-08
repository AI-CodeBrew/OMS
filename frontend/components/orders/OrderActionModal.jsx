"use client";

import { useEffect, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import { SMARTLANE_LOAD_SHEET_COURIERS } from "./statusConfig";

const FIELD_BY_ACTION = {
  assign_courier: { key: "courier_id", label: "Courier", type: "courier-select" },
  resolve_city_issue: { key: "city", label: "Corrected city", type: "text" },
  mark_dispatch_issue: { key: "note", label: "Issue note", type: "text" },
  cancel: { key: "reason", label: "Cancellation reason (optional)", type: "text", optional: true },
  print_loadsheet: { key: "courier", label: "Courier", type: "smartlane-courier-select" },
};

const ACTION_TITLES = {
  assign_courier: "Assign courier",
  resolve_city_issue: "Resolve city issue",
  mark_dispatch_issue: "Mark dispatch issue",
  cancel: "Cancel order(s)",
  print_loadsheet: "Print Load Sheet",
};

// Actions that need no input still get this popup, as a confirm step:
// `result` finishes "N orders will ...". Anything not listed falls back
// to a generic message, so a new action is never run unconfirmed.
const CONFIRM_BY_ACTION = {
  acknowledge: {
    title: "Start processing",
    button: "Start Processing",
    result: "move to Pending CC or Pending COD, by payment method",
  },
  confirm: { title: "Confirm order(s)", button: "Confirm", result: "move to Awaiting Assigning" },
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
      "be checked with Smartlane, and go back to Awaiting Assigning if the booking doesn't exist there",
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
};

export default function OrderActionModal({ action, couriers, count, onSubmit, onClose, submitting }) {
  const field = action ? FIELD_BY_ACTION[action] : null;
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [action]);

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
