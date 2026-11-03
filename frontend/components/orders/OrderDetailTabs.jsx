"use client";

import { useEffect, useState } from "react";
import OrderLogTab from "./tabs/OrderLogTab";
import OrderTicketsTab from "./tabs/OrderTicketsTab";
import TrackingTab from "./tabs/TrackingTab";

const TABS = [
  { key: "line_items", label: "Line Items" },
  { key: "tracking", label: "Tracking" },
  { key: "log", label: "Order Log" },
  { key: "tickets", label: "Tickets" },
];

// lineItems: the whole order-details view (items, money, status, Edit) -
// shown only on its own tab, so Order Log / Tickets show nothing but
// their own content. actions: the Actions dropdown, beside the tabs.
// editing: Edit was clicked (it sits beside the actions, above every tab) -
// back to Line Items, where the editing happens.
export default function OrderDetailTabs({ order, lineItems, actions, editing = false }) {
  const [active, setActive] = useState("line_items");

  useEffect(() => {
    if (editing) setActive("line_items");
  }, [editing]);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 border-b border-surface-border">
        <div className="flex gap-4 overflow-x-auto text-sm">
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
        <div className="shrink-0 pb-1.5">{actions}</div>
      </div>

      <div className="pt-3">
        {active === "line_items" ? lineItems : null}
        {active === "tracking" ? <TrackingTab orderId={order.id} /> : null}
        {active === "log" ? <OrderLogTab orderId={order.id} /> : null}
        {active === "tickets" ? <OrderTicketsTab order={order} /> : null}
      </div>
    </div>
  );
}
