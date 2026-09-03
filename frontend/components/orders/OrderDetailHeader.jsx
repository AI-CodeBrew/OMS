"use client";

import Badge from "../shared/Badge";
import Button from "../shared/Button";
import EditableField from "../shared/EditableField";
import { STATUS_LABELS } from "./statusConfig";

export default function OrderDetailHeader({ order, draft, editing, onChange, onToggleEdit, onSave, saving }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <div className="text-xs text-slate-500">Payment Status</div>
          {editing ? (
            <select
              value={draft.payment_status}
              onChange={(e) => onChange("payment_status", e.target.value)}
              className="mt-0.5 w-full rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500"
            >
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </select>
          ) : (
            <Badge variant={order.payment_status === "paid" ? "green" : "amber"}>
              {order.payment_status}
            </Badge>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-500">Status</div>
          <Badge variant="brand">{STATUS_LABELS[order.status] || order.status}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">Date</div>
          <div className="text-sm text-slate-900">
            {order.placed_at || order.created_at
              ? new Date(order.placed_at || order.created_at).toLocaleString()
              : "N/A"}
          </div>
        </div>
        <EditableField
          label="Order Source"
          value={editing ? draft.order_source : order.order_source}
          editing={editing}
          onChange={(v) => onChange("order_source", v)}
        />
        <EditableField
          label="Shipping Type"
          value={editing ? draft.shipping_type : order.shipping_type}
          editing={editing}
          onChange={(v) => onChange("shipping_type", v)}
        />
      </div>

      <div className="shrink-0">
        {editing ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onToggleEdit} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSave} loading={saving}>
              Save
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleEdit}
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}
