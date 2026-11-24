"use client";

import { useEffect, useRef, useState } from "react";
import Dropdown from "../shared/Dropdown";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";

export default function OrdersToolbar({
  search,
  onSearchChange,
  onSubmitSearch,
  // Called with the box's text once typing pauses - the search runs
  // without a Search click (user, 2026-11-23).
  onAutoSearch,
  // What this tab already shows that may match - order numbers, customer
  // names… - suggested alongside the product names.
  rowSuggestions = [],
  selectedCount,
  availableActions,
  noActionsReason = "",
  onRaiseTicket,
  onAction,
  onRefresh,
  refreshing,
  // Page-specific filter controls, shown after the search (the Dispatch
  // Hub's store/product pickers).
  extraFilters = null,
  // The Filters button - on its own at the far right.
  filtersButton = null,
  // Whether the orders on screen have any status action - with nothing
  // selected, a tab without any (Dispatched, Delivered...) shows Raise
  // ticket instead of an Actions menu.
  tabHasActions = true,
}) {
  // Product-name autocomplete for the last comma-separated term (matches
  // the multi-term search convention the input already supports).
  const [productNames, setProductNames] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef(null);
  const autoRef = useRef(null);
  const lastTerm = search.split(",").pop().trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!lastTerm) {
      setProductNames([]);
      return undefined;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await ordersService.suggestProductNames(lastTerm);
      setProductNames(results);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [lastTerm]);

  useEffect(() => () => clearTimeout(autoRef.current), []);

  // Product names, then this tab's own matches - each containing the last
  // comma-separated term, no repeats, at most 8.
  const lower = lastTerm.toLowerCase();
  const suggestions = [];
  if (lower) {
    const seen = new Set();
    for (const raw of [...productNames, ...rowSuggestions]) {
      const text = String(raw ?? "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key) || key === lower || !key.includes(lower)) continue;
      seen.add(key);
      suggestions.push(text);
      if (suggestions.length >= 8) break;
    }
  }

  function changeSearch(value) {
    onSearchChange(value);
    setShowSuggestions(true);
    setActiveIndex(-1);
    if (!onAutoSearch) return;
    clearTimeout(autoRef.current);
    // Emptied: the full list straight away (onSearchChange handles it).
    if (!value.trim()) return;
    autoRef.current = setTimeout(() => onAutoSearch(value), 500);
  }

  function pickSuggestion(name) {
    const terms = search.split(",");
    terms[terms.length - 1] = ` ${name}`;
    const next = terms.join(",").replace(/^ /, "");
    onSearchChange(next);
    setShowSuggestions(false);
    setActiveIndex(-1);
    clearTimeout(autoRef.current);
    onAutoSearch?.(next);
  }

  function onKeyDown(e) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  function highlighted(text) {
    const at = lower ? text.toLowerCase().indexOf(lower) : -1;
    if (at < 0) return text;
    return (
      <>
        {text.slice(0, at)}
        <span className="font-semibold text-brand-800">{text.slice(at, at + lower.length)}</span>
        {text.slice(at + lower.length)}
      </>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      {/* w-64 on the input alone used to force this whole form wider than
          a phone screen, since the form itself had no flex-wrap of its
          own - the outer container wrapping the form as one unit didn't
          help once the form's own content was already too wide to fit
          on one line. Full width below sm, back to the fixed desktop
          width above it. */}
      <form
        onSubmit={(e) => {
          clearTimeout(autoRef.current);
          setShowSuggestions(false);
          onSubmitSearch(e);
        }}
        className="flex w-full items-center sm:w-auto"
      >
        <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
          <input
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Search order, customer, phone, product…"
            title="Searches order no., customer, phone, product, SKU, tracking and city. Separate multiple values with commas, e.g. 87364,7386473,8343"
            className="w-full rounded-l-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
          {showSuggestions && suggestions.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-surface-border bg-white py-1 shadow-lg">
              {suggestions.map((name, i) => (
                <li key={name}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(name)}
                    title={name}
                    className={`block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 ${
                      i === activeIndex ? "bg-surface" : "hover:bg-surface"
                    }`}
                  >
                    {highlighted(name)}
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

      {extraFilters}

      {/* Actions menu only where there's an action to take; where Raise
          ticket is the only one, it's a button of its own; on a view-only
          page (All Orders, Read-only login) neither. */}
      {!onRaiseTicket && availableActions.length === 0 ? null : (selectedCount > 0
        ? availableActions.length === 0
        : !tabHasActions) ? (
        <Button
          variant="secondary"
          disabled={selectedCount !== 1}
          title={selectedCount === 1 ? "Raise a ticket for this order" : "Select one order to raise a ticket"}
          onClick={onRaiseTicket}
        >
          Raise ticket
        </Button>
      ) : (
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
            ? availableActions.map((a) =>
                a.divider
                  ? { key: a.key, divider: true }
                  : {
                      key: a.key || a.action,
                      label: a.label,
                      disabled: a.disabled,
                      onClick: () => onAction(a.action),
                    }
              )
            : [{ key: "none", label: noActionsReason || "No actions available", disabled: true }]),
          // Not a status change, so it's offered for any status - but a
          // ticket is about one order. Left out where the page gives no
          // onRaiseTicket (All Orders, which is view only).
          ...(onRaiseTicket
            ? [
                { key: "divider", divider: true },
                {
                  key: "raise_ticket",
                  label: selectedCount === 1 ? "Raise ticket" : "Raise ticket (select one order)",
                  disabled: selectedCount !== 1,
                  onClick: onRaiseTicket,
                },
              ]
            : []),
        ]}
      />
      )}

      <Button variant="secondary" onClick={onRefresh} loading={refreshing}>
        Refresh
      </Button>

      {filtersButton ? <div className="ml-auto">{filtersButton}</div> : null}
    </div>
  );
}
