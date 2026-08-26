"use client";

import { useState, useRef, useEffect } from "react";
import Button from "../shared/Button";

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DateRangeFilter({
  dateFrom,
  dateTo,
  onApplyDateRange,
  onClearDateRange,
}) {
  const [open, setOpen] = useState(false);
  const [fromInput, setFromInput] = useState(dateFrom || "");
  const [toInput, setToInput] = useState(dateTo || "");
  const containerRef = useRef(null);

  // Sync inputs when props change
  useEffect(() => {
    setFromInput(dateFrom || "");
    setToInput(dateTo || "");
  }, [dateFrom, dateTo]);

  // Handle outside click to close popover
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Quick Preset Helper Functions
  const setPreviousMonth = () => {
    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const start = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1);
    const end = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0);
    const from = formatDate(start);
    const to = formatDate(end);
    setFromInput(from);
    setToInput(to);
    onApplyDateRange(from, to);
    setOpen(false);
  };

  const setCurrentMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const from = formatDate(start);
    const to = formatDate(end);
    setFromInput(from);
    setToInput(to);
    onApplyDateRange(from, to);
    setOpen(false);
  };

  const setSpecificMonth = (monthIndex, year = new Date().getFullYear()) => {
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0);
    const from = formatDate(start);
    const to = formatDate(end);
    setFromInput(from);
    setToInput(to);
    onApplyDateRange(from, to);
    setOpen(false);
  };

  const setLastNDays = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const from = formatDate(start);
    const to = formatDate(end);
    setFromInput(from);
    setToInput(to);
    onApplyDateRange(from, to);
    setOpen(false);
  };

  const handleApply = (e) => {
    e?.preventDefault();
    onApplyDateRange(fromInput, toInput);
    setOpen(false);
  };

  const handleClear = () => {
    setFromInput("");
    setToInput("");
    onClearDateRange();
    setOpen(false);
  };

  const hasActiveFilter = Boolean(dateFrom || dateTo);

  const getLabel = () => {
    if (!dateFrom && !dateTo) return "Filter by Date";
    if (dateFrom && dateTo) {
      return `${dateFrom} to ${dateTo}`;
    }
    if (dateFrom) return `From ${dateFrom}`;
    return `To ${dateTo}`;
  };

  const now = new Date();
  const currentMonthName = now.toLocaleString("default", { month: "short" });
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthName = prevMonthDate.toLocaleString("default", { month: "short" });

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
          hasActiveFilter
            ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
            : "border-surface-border bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        <svg
          className={`h-4 w-4 ${hasActiveFilter ? "text-brand-600" : "text-slate-500"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span>{getLabel()}</span>
        {hasActiveFilter ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="ml-1 flex h-4 w-4 items-center justify-center rounded-full hover:bg-brand-200 text-brand-700 text-xs"
            title="Clear date filter"
          >
            ×
          </span>
        ) : (
          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-surface-border bg-white p-4 shadow-xl animate-in fade-in zoom-in-95">
          <div className="mb-3 flex items-center justify-between border-b border-surface-border pb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Query Orders by Date
            </h4>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-red-600 hover:underline"
              >
                Clear Filter
              </button>
            )}
          </div>

          {/* Quick Presets */}
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Quick Range Presets</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={setCurrentMonth}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 text-left transition"
              >
                🗓️ This Month ({currentMonthName})
              </button>
              <button
                type="button"
                onClick={setPreviousMonth}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 text-left transition"
              >
                🗓️ Previous Month ({prevMonthName})
              </button>
              <button
                type="button"
                onClick={() => setLastNDays(7)}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 text-left transition"
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => setLastNDays(30)}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 text-left transition"
              >
                Last 30 Days
              </button>
            </div>
          </div>

          {/* Custom Date Form */}
          <form onSubmit={handleApply} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">From Date</span>
                <input
                  type="date"
                  value={fromInput}
                  onChange={(e) => setFromInput(e.target.value)}
                  className="w-full rounded-md border border-surface-border px-2.5 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">To Date</span>
                <input
                  type="date"
                  value={toInput}
                  onChange={(e) => setToInput(e.target.value)}
                  className="w-full rounded-md border border-surface-border px-2.5 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </label>
            </div>

            <div className="flex gap-2 pt-2 border-t border-surface-border">
              <Button
                type="submit"
                className="flex-1 justify-center py-1.5 text-xs"
              >
                Apply Query
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleClear}
                className="py-1.5 text-xs"
              >
                Reset
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
