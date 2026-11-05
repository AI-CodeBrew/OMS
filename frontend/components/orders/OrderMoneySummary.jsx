"use client";

import { draftDiscountTotal, draftGrandTotal, draftReceivable, draftSubtotal } from "./orderMoney";

// Money fields, in the order they're shown - Discount is Shopify's
// order-level discount (coupon_discount) plus any given here in OMS
// (extra_discount); editing it changes only the extra part, so the Grand
// Total stays Shopify's and only the receivable moves. Amount Paid is
// typed in only for a partially paid order; on a prepaid one it stays what
// was paid and the receivable follows the other figures instead.
const MONEY_FIELDS = [
  ["shipping_amount", "Shipping"],
  ["discount_total", "Discount"],
  ["amount_paid", "Amount Paid"],
];

function isEditable(field, draft) {
  return field !== "amount_paid" || draft.payment_status === "partially_paid";
}

function MoneyCell({ label, value }) {
  return (
    <div className="rounded-md bg-brand-700 px-3 py-2 text-white">
      <div className="text-[10px] uppercase tracking-wide text-brand-100">{label}</div>
      <div className="text-sm font-semibold">PKR {value}</div>
    </div>
  );
}

function MoneyInput({ label, value, onChange }) {
  return (
    <div className="rounded-md border border-surface-border bg-white p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-surface-border px-1.5 py-1 text-sm outline-none focus:border-brand-500"
      />
    </div>
  );
}

export default function OrderMoneySummary({ order, draft, editing, onChange }) {
  const itemCount = editing ? draft.items.length : order.items.length;
  const subtotal = editing ? draftSubtotal(draft).toFixed(2) : order.total_amount;
  // Receivable is typed in only for a partially paid order - it's the
  // other side of Amount Paid (grand total - paid), so editing it moves
  // that (see OrderDetailPanel's onDraftChange).
  const receivableEditable = editing && draft.payment_status === "partially_paid";

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <MoneyCell label={`Subtotal (${itemCount} items)`} value={subtotal} />
      {MONEY_FIELDS.map(([field, label]) =>
        editing && isEditable(field, draft) ? (
          <MoneyInput
            key={field}
            label={label}
            value={
              field === "discount_total"
                ? draft.discount_total ?? draftDiscountTotal(draft).toFixed(2)
                : draft[field]
            }
            onChange={(v) => onChange(field, v)}
          />
        ) : (
          <MoneyCell
            key={field}
            label={label}
            value={(() => {
              if (field === "discount_total") {
                const value = draftDiscountTotal(editing ? draft : order).toFixed(2);
                return Number(value) > 0 ? `-${value}` : value;
              }
              return editing ? draft[field] : order[field];
            })()}
          />
        )
      )}
      {Number(order.total_tax) > 0 ? <MoneyCell label="Tax" value={order.total_tax} /> : null}
      <MoneyCell label="Grand Total" value={editing ? draftGrandTotal(draft).toFixed(2) : order.grand_total} />
      {receivableEditable ? (
        <MoneyInput
          label="Amount Receivable"
          value={draft.amount_receivable ?? draftReceivable(draft).toFixed(2)}
          onChange={(v) => onChange("amount_receivable", v)}
        />
      ) : (
        <MoneyCell
          label="Amount Receivable"
          value={editing ? draftReceivable(draft).toFixed(2) : order.amount_receivable}
        />
      )}
    </div>
  );
}
