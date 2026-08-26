"use client";

import Dropdown from "../shared/Dropdown";
import Button from "../shared/Button";
import { SEARCH_FIELDS } from "./statusConfig";

export default function OrdersToolbar({
  search,
  onSearchChange,
  searchField,
  onSearchFieldChange,
  onSubmitSearch,
  filtersOpen,
  onToggleFilters,
  selectedCount,
  availableActions,
  onAction,
  onRefresh,
  refreshing,
}) {
  const fieldLabel = SEARCH_FIELDS.find((f) => f.value === searchField)?.label || "Order Name";

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <form onSubmit={onSubmitSearch} className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search"
          className="w-56 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Dropdown
          trigger={
            <span className="inline-flex items-center gap-1 rounded-md border border-surface-border px-3 py-2 text-sm text-slate-600">
              {fieldLabel} <span className="text-xs">▾</span>
            </span>
          }
          items={SEARCH_FIELDS.map((f) => ({
            key: f.value,
            label: f.label,
            onClick: () => onSearchFieldChange(f.value),
          }))}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Button variant="secondary" onClick={onToggleFilters} className={filtersOpen ? "ring-2 ring-brand-200" : ""}>
        Add Filters
      </Button>

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
        items={availableActions.map((a) => ({
          key: a.key || a.action,
          label: a.label,
          disabled: a.disabled,
          onClick: () => onAction(a.action),
        }))}
      />

      <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}
