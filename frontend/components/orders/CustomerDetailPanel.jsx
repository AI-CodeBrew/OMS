"use client";

import EditableField from "../shared/EditableField";

const FIELD_ROWS = [
  ["customer_name", "Name"],
  ["customer_email", "Email"],
  ["customer_phone", "Number"],
  ["secondary_phone", "Secondary Number"],
  ["city", "City"],
  ["address_line1", "Address 1"],
  ["customer_tags", "Customer Tags"],
];

export default function CustomerDetailPanel({ order, draft, editing, onChange }) {
  return (
    <div className="w-72 shrink-0 space-y-3 border-r border-surface-border pr-4">
      <h3 className="text-sm font-semibold text-slate-900">Customer Detail</h3>

      {FIELD_ROWS.map(([field, label]) => (
        <EditableField
          key={field}
          label={label}
          value={editing ? draft[field] : order[field]}
          editing={editing}
          onChange={(value) => onChange(field, value)}
        />
      ))}

      <div>
        <div className="text-xs text-slate-500">Current Status Updated At</div>
        <div className="text-sm text-slate-900">
          {order.updated_at ? new Date(order.updated_at).toLocaleString() : "N/A"}
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-500">Acceptance Rate</div>
        <div className="text-sm text-slate-900">
          {order.acceptance_pct === null || order.acceptance_pct === undefined
            ? "N/A"
            : `${order.acceptance_pct}%`}
        </div>
      </div>
    </div>
  );
}
