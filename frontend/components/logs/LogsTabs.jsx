"use client";

import { useState } from "react";
import ActivityLog from "./ActivityLog";
import OrderLogs from "./OrderLogs";

const TABS = [
  { key: "all", label: "All Logs" },
  { key: "order", label: "Order Logs" },
];

// The Logs page: every change (All Logs) or one order's full history
// (Order Logs). Shared by the super admin's Logs tab (`stores` given) and a
// store's own Logs page.
export default function LogsTabs({ fetchLogs, fetchOrderLogs, stores = null }) {
  const [tab, setTab] = useState("all");

  return (
    <div className="space-y-4">
      <div className="flex border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-brand-600 text-brand-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Both stay mounted, so switching tabs keeps each one's filters and results. */}
      <div className={tab === "all" ? "" : "hidden"}>
        <ActivityLog fetchLogs={fetchLogs} stores={stores} />
      </div>
      <div className={tab === "order" ? "" : "hidden"}>
        <OrderLogs fetchOrderLogs={fetchOrderLogs} showStore={Boolean(stores)} />
      </div>
    </div>
  );
}
