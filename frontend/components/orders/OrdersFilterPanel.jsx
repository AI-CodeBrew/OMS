"use client";

import Button from "../shared/Button";

export default function OrdersFilterPanel({ filters, onChange, onApply, onClear, couriers }) {
  function update(field) {
    return (e) => onChange({ ...filters, [field]: e.target.value });
  }

  return (
    <div className="mb-3 grid grid-cols-2 gap-3 rounded-lg border border-surface-border bg-white p-4 sm:grid-cols-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">City</span>
        <input
          value={filters.city}
          onChange={update("city")}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Courier</span>
        <select
          value={filters.courier_id}
          onChange={update("courier_id")}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">Any</option>
          {(couriers || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">From</span>
          <input
            type="date"
            value={filters.date_from}
            onChange={update("date_from")}
            className="w-full rounded-md border border-surface-border px-2 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">To</span>
          <input
            type="date"
            value={filters.date_to}
            onChange={update("date_to")}
            className="w-full rounded-md border border-surface-border px-2 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
      </div>
      <div className="col-span-2 flex gap-2 sm:col-span-4">
        <Button onClick={onApply}>Apply filters</Button>
        <Button variant="secondary" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
