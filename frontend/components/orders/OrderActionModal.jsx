"use client";

import { useEffect, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";

const FIELD_BY_ACTION = {
  assign_courier: { key: "courier_id", label: "Courier", type: "courier-select" },
  resolve_city_issue: { key: "city", label: "Corrected city", type: "text" },
  mark_dispatch_issue: { key: "note", label: "Issue note", type: "text" },
  cancel: { key: "reason", label: "Cancellation reason (optional)", type: "text", optional: true },
};

const ACTION_TITLES = {
  assign_courier: "Assign courier",
  resolve_city_issue: "Resolve city issue",
  mark_dispatch_issue: "Mark dispatch issue",
  cancel: "Cancel order(s)",
};

export default function OrderActionModal({ action, couriers, count, onSubmit, onClose, submitting }) {
  const field = action ? FIELD_BY_ACTION[action] : null;
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [action]);

  if (!action || !field) return null;

  const canSubmit = field.optional || value.trim().length > 0;

  return (
    <Modal open title={ACTION_TITLES[action] || action} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        Applying to {count} order{count === 1 ? "" : "s"}.
      </p>
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
              <option key={c.id} value={c.id}>
                {c.name}
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
          disabled={!canSubmit || submitting}
          onClick={() => onSubmit({ [field.key]: value })}
        >
          {submitting ? "Applying…" : "Apply"}
        </Button>
      </div>
    </Modal>
  );
}
