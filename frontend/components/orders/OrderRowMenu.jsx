"use client";

import Dropdown from "../shared/Dropdown";
import { ACTIONS_BY_STATUS } from "./statusConfig";

export default function OrderRowMenu({ order, onAction, onRaiseTicket }) {
  const actions = ACTIONS_BY_STATUS[order.status] || [];

  // "Raise ticket" isn't a status mutation like everything in
  // ACTIONS_BY_STATUS, so it's always present here rather than filtered by
  // order.status, and dispatched through its own prop rather than
  // onAction's bulk-action pipeline.
  const items = [
    ...actions.map((a) => ({
      key: a.key || a.action,
      label: a.label,
      disabled: a.disabled,
      onClick: () => onAction(a.action, order),
    })),
    { key: "raise_ticket", label: "Raise ticket", onClick: () => onRaiseTicket(order) },
  ];

  return (
    <Dropdown
      align="right"
      trigger={
        <button
          type="button"
          className="rounded px-2 py-1 text-slate-400 hover:bg-surface hover:text-slate-700"
        >
          ⋮
        </button>
      }
      items={items}
    />
  );
}
