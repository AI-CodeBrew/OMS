"use client";

import { useEffect, useRef, useState } from "react";
import Checkbox from "../shared/Checkbox";
import ordersService from "../../services/ordersService";

// Typed filters - one or more values each, comma separated.
export const TEXT_FILTERS = [
  { key: "f_oms_id", label: "OMS Order ID", placeholder: "OMS Order ID (e.g. 14843, 14990)" },
  { key: "f_store_order_id", label: "Store Order ID", placeholder: "Store Order ID (e.g. 12787, #8114)" },
  { key: "f_customer", label: "Customer Name", placeholder: "Customer Name" },
  { key: "f_phone", label: "Phone", placeholder: "Phone (e.g. 03001234567)" },
  { key: "f_tracking", label: "Tracking", placeholder: "Tracking Number" },
];
// Picked from a list (backend: orders/filter-options).
export const LIST_FILTERS = [
  { key: "f_shop", label: "Store" },
  { key: "f_city", label: "City" },
  { key: "f_province", label: "Province" },
  { key: "f_courier", label: "Courier" },
];
export const FIELD_FILTER_KEYS = [...TEXT_FILTERS, ...LIST_FILTERS].map((f) => f.key);
// Dispatch Hub / All Orders: organizations (`store`, comma-separated ids)
// and products (`product`, JSON array of names).
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

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** How many filters are set in `applied` - the Filters button's badge. */
export function activeFilterCount(applied, { hub = false } = {}) {
  const keys = [...FIELD_FILTER_KEYS, ...(hub ? HUB_KEYS : [])];
  return keys.filter((k) => applied[k]).length;
}

const fieldClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-500";

// A list filter, opened in place (not a floating dropdown, so the popup's
// scroll never cuts it off): a search box and a checkbox list with each
// choice's order count. `load(q)` gives [{value, label, count}].
function ListField({ label, selected, onChange, load, deps, emptyText }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!open) return undefined;
    clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await loadRef.current(query.trim());
        if (!cancelled) setRows(result || []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, deps]);

  // Ticked values stay listed (first), so they can always be unticked.
  const listed = rows.map((r) => r.value);
  const all = [...selected.filter((v) => !listed.includes(v)).map((v) => ({ value: v, label: v })), ...rows];
  const labelOf = (v) => rows.find((r) => r.value === v)?.label || v;

  return (
    <div className="min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${fieldClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected.length ? "text-slate-800" : "text-slate-400"}`}>
          {selected.length
            ? selected.length <= 2
              ? selected.map(labelOf).join(", ")
              : `${label}: ${selected.length} selected`
            : `Select ${label}`}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="mb-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
          />
          <div className="max-h-48 overflow-auto">
            {loading && !all.length ? (
              <p className="px-2 py-1.5 text-sm text-slate-400">Loading…</p>
            ) : !all.length ? (
              <p className="px-2 py-1.5 text-sm text-slate-400">{emptyText || "Nothing to pick."}</p>
            ) : (
              all.map((r) => (
                <label
                  key={r.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-white"
                >
                  <Checkbox checked={selected.includes(r.value)} onChange={() => onChange(toggle(selected, r.value))} />
                  <span className="min-w-0 flex-1 truncate" title={r.label}>
                    {r.label}
                  </span>
                  {r.count != null ? <span className="shrink-0 text-xs text-slate-400">{r.count}</span> : null}
                </label>
              ))
            )}
          </div>
          {selected.length ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 px-2 text-xs font-medium text-brand-700 hover:underline"
            >
              Unselect all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// One row: the "use this filter" checkbox, then the field. The checkbox
// ticks itself when the field gets a value; unticking keeps the value but
// leaves the filter out.
function Row({ on, onToggle, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="pt-2.5">
        <Checkbox checked={on} onChange={onToggle} />
      </span>
      {children}
    </div>
  );
}

/**
 * The Orders page's Filters popup, on the right. Every filter takes one or
 * more values; several filters together must all match. Nothing changes
 * until Apply filters.
 *
 * applied: the page's applied filters ({f_oms_id: '["1","2"]', ...});
 * baseParams: the page's current query (tab, dates, search) - list
 * choices are counted over it; hub: {stores, status} in the Dispatch Hub /
 * All Orders; onApply(next) gets the values to merge into the applied
 * filters.
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
  // Which filters are on - a filter with a value starts on.
  const [on, setOn] = useState(() =>
    Object.fromEntries([...FIELD_FILTER_KEYS, ...HUB_KEYS].map((k) => [k, Boolean(applied[k])]))
  );

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function setFilterOn(key, value) {
    setOn((o) => ({ ...o, [key]: value }));
  }

  function build(empty = false) {
    const next = {};
    TEXT_FILTERS.forEach((f) => {
      const terms = empty || !on[f.key] ? [] : splitTerms(texts[f.key]);
      next[f.key] = terms.length ? JSON.stringify(terms) : "";
    });
    LIST_FILTERS.forEach((f) => {
      const picked = empty || !on[f.key] ? [] : lists[f.key];
      next[f.key] = picked.length ? JSON.stringify(picked) : "";
    });
    if (hub) {
      next.store = empty || !on.store ? "" : storeIds.join(",");
      next.product = !empty && on.product && productNames.length ? JSON.stringify(productNames) : "";
    }
    return next;
  }

  // List choices are counted over the page's view without these filters -
  // so ticking one doesn't hide the rest; the picked organizations do
  // narrow them.
  const listBase = { ...baseParams };
  [...FIELD_FILTER_KEYS, ...HUB_KEYS].forEach((k) => delete listBase[k]);
  if (hub && on.store && storeIds.length) listBase.store = storeIds.join(",");
  const listKey = JSON.stringify(listBase);

  function loadOptions(field) {
    return async (q) => {
      const data = await ordersService.filterOptions({ ...listBase, field, q });
      return data.results || [];
    };
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden="true" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(build());
          onClose();
        }}
        className="absolute bottom-4 right-4 top-4 flex w-[calc(100%-2rem)] max-w-md flex-col rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Filters</h2>
            <p className="text-xs text-slate-500">Fill any field - several values with commas</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {TEXT_FILTERS.map((f) => (
            <Row key={f.key} on={on[f.key]} onToggle={() => setFilterOn(f.key, !on[f.key])}>
              <input
                value={texts[f.key]}
                onChange={(e) => {
                  const value = e.target.value;
                  setTexts((t) => ({ ...t, [f.key]: value }));
                  setFilterOn(f.key, Boolean(value.trim()));
                }}
                placeholder={f.placeholder}
                className={fieldClass}
              />
            </Row>
          ))}

          <div className="border-t border-slate-100" />

          {hub ? (
            <>
              <Row on={on.store} onToggle={() => setFilterOn("store", !on.store)}>
                <ListField
                  label="Organization"
                  selected={storeIds}
                  onChange={(ids) => {
                    setStoreIds(ids);
                    setFilterOn("store", ids.length > 0);
                    // Products may only exist in an organization no longer picked.
                    setProductNames([]);
                    setFilterOn("product", false);
                  }}
                  deps={hub.stores.length}
                  load={async (q) =>
                    hub.stores
                      .filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
                      .map((s) => ({ value: s.id, label: s.name }))
                  }
                />
              </Row>
              <Row on={on.product} onToggle={() => setFilterOn("product", !on.product)}>
                <ListField
                  label="Products"
                  selected={productNames}
                  onChange={(names) => {
                    setProductNames(names);
                    setFilterOn("product", names.length > 0);
                  }}
                  deps={`${storeIds.join(",")}|${hub.status || ""}`}
                  emptyText={storeIds.length ? "No products in this view." : "Select an organization first."}
                  load={async (q) => {
                    if (!storeIds.length) return [];
                    const data = await ordersService.storeProducts({
                      store: storeIds.join(","),
                      status: hub.status,
                      q,
                    });
                    return (data.results || []).map((p) => ({
                      value: p.product_name,
                      label: p.product_name,
                      count: p.order_count,
                    }));
                  }}
                />
              </Row>
            </>
          ) : null}

          {LIST_FILTERS.map((f) => (
            <Row key={f.key} on={on[f.key]} onToggle={() => setFilterOn(f.key, !on[f.key])}>
              <ListField
                label={f.label}
                selected={lists[f.key]}
                onChange={(values) => {
                  setLists((l) => ({ ...l, [f.key]: values }));
                  setFilterOn(f.key, values.length > 0);
                }}
                deps={listKey}
                load={loadOptions(f.key)}
              />
            </Row>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              setTexts(Object.fromEntries(TEXT_FILTERS.map((f) => [f.key, ""])));
              setLists(Object.fromEntries(LIST_FILTERS.map((f) => [f.key, []])));
              setStoreIds([]);
              setProductNames([]);
              setOn(Object.fromEntries([...FIELD_FILTER_KEYS, ...HUB_KEYS].map((k) => [k, false])));
              onApply(build(true));
            }}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            Clear all
          </button>
          <button
            type="submit"
            className="flex-1 rounded-full bg-brand-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-900"
          >
            Apply filters
          </button>
        </div>
      </form>
    </div>
  );
}
