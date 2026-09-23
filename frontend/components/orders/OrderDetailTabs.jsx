"use client";

import { useState } from "react";
import LineItemsTab from "./tabs/LineItemsTab";
import OrderLogTab from "./tabs/OrderLogTab";
import OrderTicketsTab from "./tabs/OrderTicketsTab";

const TABS = [
  { key: "line_items", label: "Line Items" },
  { key: "log", label: "Order Log" },
  { key: "tickets", label: "Tickets" },
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
        {active === "log" ? <OrderLogTab orderId={orderId} /> : null}
        {active === "tickets" ? <OrderTicketsTab order={order} /> : null}
      </div>
    </div>
  );
}
