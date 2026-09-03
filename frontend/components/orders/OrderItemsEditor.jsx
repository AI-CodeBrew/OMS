"use client";

import Button from "../shared/Button";
import { ACTIONS_BY_STATUS } from "./statusConfig";

const MONEY_FIELDS = [
  ["coupon_discount", "Coupon Code Dis."],
  ["gift_card_discount", "Gift Card Dis."],
  ["loyalty_amount", "Loyalty Amount"],
  ["wallet_amount", "Wallet Amount"],
  ["total_tax", "Total Tax"],
  ["donation_amount", "Donation Amount"],
  ["shipping_amount", "Shipping"],
  ["express_stitching_amount", "Express Stitching"],
  ["amount_paid", "Amount Paid"],
];

// Statuses where dispatch is a live concern - only these show Scan and
// Download Invoices, matching the "Approved" reference UI. Everywhere else
// those buttons wouldn't do anything meaningful yet.
const DISPATCH_STAGE_STATUSES = new Set(["approved", "awaiting_dispatched", "dispatch_issue"]);

function MoneyCell({ label, value }) {
  return (
    <div className="rounded-md bg-brand-700 px-3 py-2 text-white">
      <div className="text-[10px] uppercase tracking-wide text-brand-100">{label}</div>
      <div className="text-sm font-semibold">PKR {value}</div>
    </div>
  );
}

export default function OrderItemsEditor({ order, draft, editing, onChange, onAction, onScan, working }) {
  const actions = ACTIONS_BY_STATUS[order.status] || [];
  const showDispatchTools = DISPATCH_STAGE_STATUSES.has(order.status);

  return (
    <div className="mt-6 space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MoneyCell label={`Subtotal (${order.items.length} items)`} value={order.total_amount} />
        {MONEY_FIELDS.map(([field, label]) =>
          editing ? (
            <div key={field} className="rounded-md border border-surface-border bg-white p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
              <input
                type="number"
                step="0.01"
                value={draft[field]}
                onChange={(e) => onChange(field, e.target.value)}
                className="mt-1 w-full rounded border border-surface-border px-1.5 py-1 text-sm outline-none focus:border-brand-500"
              />
            </div>
          ) : (
            <MoneyCell key={field} label={label} value={order[field]} />
          )
        )}
        <MoneyCell label="Grand Total" value={order.grand_total} />
        <MoneyCell label="Amount Receivable" value={order.amount_receivable} />
        <MoneyCell label="You Owe Customer" value={order.owed_to_customer} />
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-surface-border pt-4">
        {showDispatchTools ? (
          <>
            <Button variant="secondary" onClick={onScan}>
              Scan
            </Button>
            <Button variant="secondary" disabled title="Invoicing not configured">
              Download Invoices ▾
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled title="No telephony provider configured">
            Initiate IVR Call
          </Button>
        )}

        {actions.map((a) => (
          <Button
            key={a.key || a.action}
            variant={a.action === "cancel" ? "danger" : a.action === "dispatch" || a.action === "confirm" ? "primary" : "secondary"}
            disabled={a.disabled}
            loading={working}
            title={a.disabled ? "Not set up yet" : undefined}
            onClick={() => onAction(a.action)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
