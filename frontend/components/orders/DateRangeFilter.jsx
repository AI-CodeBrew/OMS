"use client";

import { useState, useRef, useEffect } from "react";
import Button from "../shared/Button";
import { DASHBOARD_PRESETS, dashboardRangeForPreset } from "../../lib/viewCache";
import DateInput, { formatDmy } from "../shared/DateInput";

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRange(offset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  // The current month runs to today; a past month to its last day.
  const end = offset === 0 ? now : new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { date_from: formatDate(start), date_to: formatDate(end) };
}

// Same choices as the Dashboard's date filter (Today / Yesterday / Last 7 /
// Last 30 days, then Custom), plus the two month presets. No "All time" -
// every list opens on the last 30 days (store/dateFilterStore).
const PRESETS = [
  ...DASHBOARD_PRESETS.map((p) => ({ ...p, range: () => dashboardRangeForPreset(p.key) })),
  { key: "this_month", label: "This month", range: () => monthRange(0) },
  { key: "last_month", label: "Last month", range: () => monthRange(-1) },
];

function presetFor(dateFrom, dateTo) {
  return PRESETS.find((p) => {
    const r = p.range();
    return r.date_from === (dateFrom || "") && r.date_to === (dateTo || "");
  });
}

export default function DateRangeFilter({
  dateFrom,
  dateTo,
  onApplyDateRange,
}) {
  const [open, setOpen] = useState(false);
  const preset = presetFor(dateFrom, dateTo);
  const activeKey = preset ? preset.key : "custom";
  const [showCustom, setShowCustom] = useState(activeKey === "custom");
  const [draft, setDraft] = useState({ date_from: dateFrom || "", date_to: dateTo || "" });
  const ref = useRef(null);

  useEffect(() => {
    setDraft({ date_from: dateFrom || "", date_to: dateTo || "" });
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function pick(p) {
    setShowCustom(false);
    setOpen(false);
    const r = p.range();
    onApplyDateRange(r.date_from, r.date_to);
  }

  const label = preset
    ? preset.label
    : `${formatDmy(dateFrom) || "Start"} to ${formatDmy(dateTo) || "Today"}`;

  const dateInput =
    "w-full rounded-md border border-surface-border px-2.5 py-1.5 text-sm outline-none focus:border-brand-500";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {label}
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-surface-border bg-white py-1 shadow-lg">
          {PRESETS.map((p) => {
            const selected = p.key === activeKey && !showCustom;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => pick(p)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-surface ${
                  selected ? "font-medium text-brand-800" : "text-slate-700"
                }`}
              >
                {p.label}
                {selected ? <span className="text-brand-700">✓</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowCustom(true)}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-surface ${
              activeKey === "custom" || showCustom ? "font-medium text-brand-800" : "text-slate-700"
            }`}
          >
            Custom
            {activeKey === "custom" || showCustom ? <span className="text-brand-700">✓</span> : null}
          </button>
          {showCustom ? (
            <div className="mt-1 space-y-2 border-t border-surface-border px-3 pb-2 pt-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
                <DateInput
                  value={draft.date_from}
                  onChange={(e) => setDraft((d) => ({ ...d, date_from: e.target.value }))}
                  className={dateInput}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
                <DateInput
                  value={draft.date_to}
                  onChange={(e) => setDraft((d) => ({ ...d, date_to: e.target.value }))}
                  className={dateInput}
                />
              </label>
              <Button
                className="w-full"
                disabled={!draft.date_from && !draft.date_to}
                onClick={() => {
                  onApplyDateRange(draft.date_from, draft.date_to);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
