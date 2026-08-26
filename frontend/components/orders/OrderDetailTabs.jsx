"use client";

import { useState } from "react";
import LineItemsTab from "./tabs/LineItemsTab";
import TransactionDetailTab from "./tabs/TransactionDetailTab";
import OrderNotesList from "./tabs/OrderNotesList";
import OrderLogTab from "./tabs/OrderLogTab";
import CustomerHistoryTab from "./tabs/CustomerHistoryTab";

const TABS = [
  { key: "line_items", label: "Line Items" },
  { key: "transactions", label: "Transaction Detail" },
  { key: "comments", label: "Comments" },
  { key: "log", label: "Order Log" },
  { key: "custom_message", label: "Custom Message" },
  { key: "notes", label: "Notes" },
  { key: "customer_history", label: "Customer History" },
];

export default function OrderDetailTabs({ order, onOrderChanged }) {
  const [active, setActive] = useState("line_items");
  const orderId = order.id;

  return (
    <div className="mt-4">
      <div className="flex gap-4 overflow-x-auto border-b border-surface-border text-sm">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-1 pb-2 pt-1 ${
              active === tab.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-3">
        {active === "line_items" ? <LineItemsTab order={order} onOrderChanged={onOrderChanged} /> : null}
        {active === "transactions" ? <TransactionDetailTab orderId={orderId} /> : null}
        {active === "comments" ? (
          <OrderNotesList orderId={orderId} kind="comment" placeholder="Add a comment" />
        ) : null}
        {active === "log" ? <OrderLogTab orderId={orderId} /> : null}
        {active === "custom_message" ? (
          <OrderNotesList orderId={orderId} kind="custom_message" placeholder="Add a custom message" />
        ) : null}
        {active === "notes" ? (
          <OrderNotesList orderId={orderId} kind="note" placeholder="Add a note" />
        ) : null}
        {active === "customer_history" ? <CustomerHistoryTab orderId={orderId} /> : null}
      </div>
    </div>
  );
}
