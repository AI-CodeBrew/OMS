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
      {/* w-64 on the input alone used to force this whole form wider than
          a phone screen, since the form itself had no flex-wrap of its
          own - the outer container wrapping the form as one unit didn't
          help once the form's own content was already too wide to fit
          on one line. Full width below sm, back to the fixed desktop
          width above it. */}
      <form
        onSubmit={onSubmitSearch}
        className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap"
      >
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search — separate multiple with commas"
          title="Separate multiple values with commas, e.g. 87364,7386473,8343"
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-64"
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

      <Button variant="secondary" onClick={onRefresh} loading={refreshing}>
        Refresh
      </Button>
    </div>
  );
}
