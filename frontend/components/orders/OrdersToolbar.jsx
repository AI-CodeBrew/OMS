"use client";

import { useEffect, useRef, useState } from "react";
import Dropdown from "../shared/Dropdown";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";

const SORT_OPTIONS = [
  { key: "date", label: "Date & Time" },
  { key: "oms_id", label: "OMS Order ID" },
  { key: "store_id", label: "Store Order ID" },
];

export default function OrdersToolbar({
  search,
  onSearchChange,
  onSubmitSearch,
  selectedCount,
  availableActions,
  noActionsReason = "",
  onRaiseTicket,
  onAction,
  onRefresh,
  refreshing,
  sortBy,
  onSortChange,
}) {
  // Product-name autocomplete for the last comma-separated term (matches
  // the multi-term search convention the input already supports).
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    const term = search.split(",").pop().trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!term) {
      setSuggestions([]);
      return undefined;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await ordersService.suggestProductNames(term);
      setSuggestions(results);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  function pickSuggestion(name) {
    const terms = search.split(",");
    terms[terms.length - 1] = ` ${name}`;
    onSearchChange(terms.join(",").replace(/^ /, ""));
    setShowSuggestions(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      {/* w-64 on the input alone used to force this whole form wider than
          a phone screen, since the form itself had no flex-wrap of its
          own - the outer container wrapping the form as one unit didn't
          help once the form's own content was already too wide to fit
          on one line. Full width below sm, back to the fixed desktop
          width above it. */}
      <form
        onSubmit={onSubmitSearch}
        className="flex w-full items-center sm:w-auto"
      >
        <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Search order, customer, phone, product…"
            title="Searches order no., customer, phone, product, SKU, tracking and city. Separate multiple values with commas, e.g. 87364,7386473,8343"
            className="w-full rounded-l-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {showSuggestions && suggestions.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full rounded-md border border-surface-border bg-white py-1 shadow-lg">
              {suggestions.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(name)}
                    className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-surface"
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Button type="submit" variant="secondary" className="-ml-px shrink-0 rounded-l-none">
          Search
        </Button>
      </form>

      <Button variant="secondary" disabled title="Coming soon">
        Saved Filters
      </Button>

      <Dropdown
        disabled={selectedCount === 0}
        trigger={
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm font-medium ${
              selectedCount === 0
                ? "border-surface-border text-slate-400"
                : "border-surface-border bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            Actions {selectedCount > 0 ? `(${selectedCount})` : ""} <span className="text-xs">▾</span>
          </span>
        }
        items={[
          ...(availableActions.length > 0
            ? availableActions.map((a) => ({
                key: a.key || a.action,
                label: a.label,
                disabled: a.disabled,
                onClick: () => onAction(a.action),
              }))
            : [{ key: "none", label: noActionsReason || "No actions available", disabled: true }]),
          // Not a status change, so it's offered for any status - but a
          // ticket is about one order.
          { key: "divider", divider: true },
          {
            key: "raise_ticket",
            label: selectedCount === 1 ? "Raise ticket" : "Raise ticket (select one order)",
            disabled: selectedCount !== 1,
            onClick: onRaiseTicket,
          },
        ]}
      />

      <Dropdown
        trigger={
          <span className="inline-flex items-center gap-1 rounded-md border border-surface-border px-3 py-2 text-sm text-slate-600">
            <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2" />
            </svg>
            {SORT_OPTIONS.find((o) => o.key === sortBy)?.label ?? "Date & Time"}
            <span className="text-xs">▾</span>
          </span>
        }
        items={SORT_OPTIONS.map((o) => ({
          key: o.key,
          label: o.key === sortBy ? `✓ ${o.label}` : o.label,
          onClick: () => onSortChange(o.key),
        }))}
      />

      <Button variant="secondary" onClick={onRefresh} loading={refreshing}>
        Refresh
      </Button>
    </div>
  );
}
