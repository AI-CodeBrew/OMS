"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";
import HubOrderFilters, { MultiSelect, OptionRow, toggle } from "./HubOrderFilters";

// Typed filters - one or more values each, comma separated.
export const TEXT_FILTERS = [
  { key: "f_oms_id", label: "OMS Order ID", placeholder: "e.g. 14843, 14990" },
  { key: "f_store_order_id", label: "Store Order ID", placeholder: "e.g. 12787, #8114" },
  { key: "f_customer", label: "Customer Name", placeholder: "e.g. Ali, Sara" },
  { key: "f_phone", label: "Phone", placeholder: "e.g. 03001234567" },
  { key: "f_tracking", label: "Tracking", placeholder: "e.g. LHR722052611505" },
];
// Picked from a list (backend: orders/filter-options).
export const LIST_FILTERS = [
  { key: "f_shop", label: "Store" },
  { key: "f_city", label: "City" },
  { key: "f_province", label: "Province" },
  { key: "f_courier", label: "Courier" },
];
export const FIELD_FILTER_KEYS = [...TEXT_FILTERS, ...LIST_FILTERS].map((f) => f.key);
// Dispatch Hub / All Orders: organizations (comma-separated ids) and
// products (JSON array) - HubOrderFilters.
const HUB_KEYS = ["store", "product"];

function parse(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function splitTerms(text) {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** How many filters are set in `applied` - the Filters button's badge. */
export function activeFilterCount(applied, { hub = false } = {}) {
  const keys = [...FIELD_FILTER_KEYS, ...(hub ? HUB_KEYS : [])];
  return keys.filter((k) => applied[k]).length;
}

// One list filter: a searchable checkbox list of what the page's orders
// hold (with the other filters applied), each with its order count.
function ListFilter({ field, label, selected, onChange, baseParams }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const debounceRef = useRef(null);
  const paramsKey = JSON.stringify(baseParams);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = { ...JSON.parse(paramsKey), field, q: query.trim() };
        delete params[field];
        const data = await ordersService.filterOptions(params);
        if (cancelled) return;
        setRows(data.results || []);
        setTruncated(Boolean(data.truncated));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [field, query, paramsKey]);

  // Ticked values stay listed (first), so they can always be unticked.
  const listed = rows.map((r) => r.value);
  const all = [...selected.filter((v) => !listed.includes(v)).map((v) => ({ value: v, label: v })), ...rows];

  return (
    <MultiSelect label={label} selectedCount={selected.length} fullWidth>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${label.toLowerCase()}…`}
        className="mb-2 w-full rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
      />
      <div className="max-h-64 overflow-auto">
        {loading && !all.length ? (
          <p className="px-2 py-1.5 text-sm text-slate-400">Loading…</p>
        ) : !all.length ? (
          <p className="px-2 py-1.5 text-sm text-slate-400">Nothing to pick.</p>
        ) : (
          all.map((r) => (
            <OptionRow key={r.value} checked={selected.includes(r.value)} onChange={() => onChange(toggle(selected, r.value))}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate" title={r.label}>
                  {r.label}
                </span>
                {r.count != null ? <span className="shrink-0 text-xs text-slate-400">{r.count}</span> : null}
              </span>
            </OptionRow>
          ))
        )}
      </div>
      {truncated ? <p className="mt-1 px-2 text-xs text-slate-400">Showing the top 300 - search to narrow.</p> : null}
      {selected.length ? (
        <button
          type="button"
          onClick={() => onChange([])}
          className="mt-1 px-2 text-xs font-medium text-brand-700 hover:underline"
        >
          Unselect all
        </button>
      ) : null}
    </MultiSelect>
  );
}

/**
 * The Orders page's Filters panel (opened by the Filters button). Every
 * filter takes one or more values; several filters together must all
 * match. Nothing changes until Apply.
 *
 * applied: the page's applied filters ({f_oms_id: '["1","2"]', ...});
 * baseParams: the page's current query (tab, dates, search) - list
 * choices are counted over it; onApply(next) gets the f_* (and, in the
 * Hub, store/product) values to merge into the applied filters.
 */
export default function OrderFieldFilters({ applied, baseParams, hub = null, onApply, onClose }) {
  const [texts, setTexts] = useState(() =>
    Object.fromEntries(TEXT_FILTERS.map((f) => [f.key, parse(applied[f.key]).join(", ")]))
  );
  const [lists, setLists] = useState(() =>
    Object.fromEntries(LIST_FILTERS.map((f) => [f.key, parse(applied[f.key])]))
  );
  const [storeIds, setStoreIds] = useState(() => (applied.store ? applied.store.split(",") : []));
  const [productNames, setProductNames] = useState(() => parse(applied.product));

  function build(empty = false) {
    const next = {};
    TEXT_FILTERS.forEach((f) => {
      const terms = empty ? [] : splitTerms(texts[f.key]);
      next[f.key] = terms.length ? JSON.stringify(terms) : "";
    });
    LIST_FILTERS.forEach((f) => {
      const picked = empty ? [] : lists[f.key];
      next[f.key] = picked.length ? JSON.stringify(picked) : "";
    });
    if (hub) {
      next.store = empty ? "" : storeIds.join(",");
      next.product = !empty && productNames.length ? JSON.stringify(productNames) : "";
    }
    return next;
  }

  // List choices are counted over the page's view without this panel's
  // own filters - so ticking one doesn't hide the rest.
  const listBase = { ...baseParams };
  [...FIELD_FILTER_KEYS, ...HUB_KEYS].forEach((k) => delete listBase[k]);
  if (hub && storeIds.length) listBase.store = storeIds.join(",");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onApply(build());
      }}
      className="mb-3 rounded-lg border border-surface-border bg-white p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {TEXT_FILTERS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">{f.label}</span>
            <input
              value={texts[f.key]}
              onChange={(e) => setTexts((t) => ({ ...t, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
        ))}
        {hub ? (
          <div className="block sm:col-span-2 lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-700">Organization / Products</span>
            <div className="grid grid-cols-2 gap-2">
              <HubOrderFilters
                stores={hub.stores}
                storeIds={storeIds}
                productNames={productNames}
                status={hub.status}
                fullWidth
                onChange={({ storeIds: s, productNames: p }) => {
                  setStoreIds(s);
                  setProductNames(p);
                }}
              />
            </div>
          </div>
        ) : null}
        {LIST_FILTERS.map((f) => (
          <div key={f.key} className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">{f.label}</span>
            <ListFilter
              field={f.key}
              label={f.label}
              selected={lists[f.key]}
              onChange={(values) => setLists((l) => ({ ...l, [f.key]: values }))}
              baseParams={listBase}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Separate several values with commas. Each filter matches any of its values; filters used together must all
        match.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit">Apply Filters</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setTexts(Object.fromEntries(TEXT_FILTERS.map((f) => [f.key, ""])));
            setLists(Object.fromEntries(LIST_FILTERS.map((f) => [f.key, []])));
            setStoreIds([]);
            setProductNames([]);
            onApply(build(true));
          }}
        >
          Clear All
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  );
}
