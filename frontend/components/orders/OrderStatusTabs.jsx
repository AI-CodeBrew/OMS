"use client";

import { STATUS_TABS } from "./statusConfig";

export default function OrderStatusTabs({ counts, activeStatus, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {STATUS_TABS.map((tab) => {
        const isActive = tab.value === activeStatus;
        const count = counts?.[tab.value] ?? 0;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`min-w-[104px] shrink-0 rounded-md border px-3 py-2 text-left transition ${
              isActive
                ? "border-brand-600 bg-brand-50"
                : "border-surface-border bg-white hover:border-slate-300"
            }`}
          >
            <div
              className={`text-[11px] font-medium uppercase tracking-wide ${
                isActive ? "text-brand-700" : "text-slate-500"
              }`}
            >
              {tab.label}
            </div>
            <div className={`mt-0.5 text-lg font-semibold ${isActive ? "text-brand-700" : "text-slate-900"}`}>
              {count}
            </div>
          </button>
        );
      })}
    </div>
  );
}
