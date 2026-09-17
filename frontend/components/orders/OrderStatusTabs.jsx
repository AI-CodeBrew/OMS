"use client";

import { STATUS_TABS } from "./statusConfig";

// Left-edge accent per tab.tone (see statusConfig.js) - a quiet signal for
// scanning inactive tabs, not a full colored background.
const TONE_BORDER = {
  neutral: "border-l-slate-300",
  blue: "border-l-blue-400",
  amber: "border-l-amber-400",
  indigo: "border-l-indigo-400",
  green: "border-l-green-400",
  red: "border-l-red-400",
};

export default function OrderStatusTabs({ counts, activeStatus, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {STATUS_TABS.map((tab) => {
        const isActive = tab.value === activeStatus;
        const count = counts?.[tab.value] ?? 0;
        // Idle (zero-count) tabs recede so busy ones pop out of the row -
        // only for inactive tabs, the active one always reads at full weight.
        const isZero = !isActive && counts != null && count === 0;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`relative h-[60px] w-[112px] shrink-0 rounded-md border border-l-4 text-left transition ${
              isActive
                ? "border-brand-600 bg-brand-50"
                : `border-surface-border ${TONE_BORDER[tab.tone] || TONE_BORDER.neutral} bg-white hover:border-slate-300`
            }`}
          >
            <div
              className={`absolute left-2 right-2 top-2 text-[10px] font-medium uppercase leading-tight ${
                isActive ? "text-brand-700" : "text-slate-500"
              }`}
            >
              {tab.label}
            </div>
            <div
              className={`absolute bottom-1.5 right-2 whitespace-nowrap text-lg font-semibold ${
                isActive ? "text-brand-700" : isZero ? "text-slate-300" : "text-slate-900"
              }`}
            >
              {counts == null ? "—" : count}
            </div>
          </button>
        );
      })}
    </div>
  );
}
