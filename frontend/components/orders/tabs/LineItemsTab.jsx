"use client";

import EditableField from "../../shared/EditableField";
import FynkTechDispatchTag from "../FynkTechDispatchTag";
import { ReplacementMark, TicketMark } from "../OrdersTable";

const ITEM_FIELDS = [
  ["product_name", "Product", "text"],
  ["unit_price", "Price", "number"],
  ["quantity", "Qty", "number"],
  ["discount_amount", "Discount Amount", "number"],
];

// Line items edit through the detail panel's single Edit (draft.items),
// saved together with every other field - no per-item Edit/Save here.
export default function LineItemsTab({ order, draft, editing, onChange }) {
  const items = editing ? draft.items : order.items;

  function onItemChange(index, field, value) {
    onChange(
      "items",
      draft.items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 rounded-md bg-brand-800 px-4 py-3 text-sm text-white sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">OMS Order ID</div>
          {order.supabase_order_no ?? "N/A"}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Store Order ID</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {order.order_number}
            <ReplacementMark order={order} onDark />
            <TicketMark order={order} onDark />
          </div>
          {order.recreate_type === "replacement" && order.recreated_from_number ? (
            <div className="mt-0.5 text-[11px] text-brand-100">
              Replacement for {order.recreated_from_number}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Location</div>
          {order.city || "—"}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Courier Status</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {order.courier_name || "Unassigned"}
            {order.dispatched_by_fynktech ? <FynkTechDispatchTag onDark /> : null}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Fulfillment Status</div>
          {order.fulfillment_status}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Tracking Number</div>
          {order.tracking_number || "N/A"}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={item.id || index} className="rounded-md border border-surface-border bg-white p-3">
            {editing ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ITEM_FIELDS.map(([field, label, type]) => (
                  <EditableField
                    key={field}
                    label={label}
                    type={type}
                    editing
                    value={item[field]}
                    onChange={(v) => onItemChange(index, field, v)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 font-medium text-slate-900">{item.product_name}</p>
                {/* Fixed column widths so Price/QTY/Discount/Total line up
                    across every item, whatever the numbers' lengths. */}
                <div className="grid shrink-0 grid-cols-[5.5rem_3rem_7.5rem_5.5rem] gap-x-4 text-sm text-slate-600">
                  <div>
                    <div className="text-xs text-slate-400">Price</div>
                    {item.unit_price}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">QTY</div>
                    {item.quantity}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Discount Amount</div>
                    {item.discount_amount}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Total</div>
                    {(item.quantity * item.unit_price - (item.discount_amount || 0)).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
