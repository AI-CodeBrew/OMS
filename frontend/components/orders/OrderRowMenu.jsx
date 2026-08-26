"use client";

import Dropdown from "../shared/Dropdown";
import { ACTIONS_BY_STATUS } from "./statusConfig";

export default function OrderRowMenu({ order, onAction }) {
  const actions = ACTIONS_BY_STATUS[order.status] || [];
  if (actions.length === 0) {
    return <span className="text-slate-300">—</span>;
  }

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
      items={actions.map((a) => ({
        key: a.key || a.action,
        label: a.label,
        disabled: a.disabled,
        onClick: () => onAction(a.action, order),
      }))}
    />
  );
}
