"use client";

import { useEffect, useRef, useState } from "react";
import Checkbox from "../shared/Checkbox";
import ordersService from "../../services/ordersService";

// A trigger button plus a checkbox list that stays open while ticking -
// shared Dropdown closes on every click, which suits actions, not picking
// several values.
function MultiSelect({ label, selectedCount, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm ${
          selectedCount
            ? "border-brand-300 bg-brand-50 text-brand-800"
            : "border-surface-border bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
        {selectedCount ? ` (${selectedCount})` : ""}
        <span className="text-xs">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-80 rounded-md border border-surface-border bg-white p-2 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function OptionRow({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-surface">
      <Checkbox checked={checked} onChange={onChange} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </label>
  );
}

// Dispatch Hub only. Stores narrows the combined list to the picked
// stores; Products then lists each product in those stores' orders (in the
// current tab) once, and ticking products narrows the table to every order
// containing any of them. storeIds / productNames are arrays; each change
// applies straight away.
export default function HubOrderFilters({ stores, storeIds, productNames, status, onChange }) {
  const [storeQuery, setStoreQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const debounceRef = useRef(null);
  const storeKey = storeIds.join(",");

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!storeKey) {
      setProducts([]);
      setTruncated(false);
      return undefined;
    }
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setLoadingProducts(true);
      try {
        const data = await ordersService.storeProducts({ store: storeKey, status, q: productQuery.trim() });
        if (cancelled) return;
        setProducts(data.results || []);
        setTruncated(Boolean(data.truncated));
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [storeKey, status, productQuery]);

  const visibleStores = stores.filter((s) => s.name.toLowerCase().includes(storeQuery.trim().toLowerCase()));
  // Ticked products stay listed (first) even when the search or tab no
  // longer returns them, so they can always be unticked.
  const listed = products.map((p) => p.product_name);
  const rows = [
    ...productNames.filter((name) => !listed.includes(name)).map((name) => ({ product_name: name })),
    ...products,
  ];
  const inputClass =
    "mb-2 w-full rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500";

  // A store change drops the ticked products - some may only exist in a
  // store that's no longer picked.
  function setStores(next) {
    onChange({ storeIds: next, productNames: [] });
  }

  return (
    <>
      <MultiSelect label="Stores" selectedCount={storeIds.length}>
        <input
          value={storeQuery}
          onChange={(e) => setStoreQuery(e.target.value)}
          placeholder="Search stores…"
          className={inputClass}
        />
        <div className="max-h-64 overflow-auto">
          {visibleStores.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-slate-400">No stores</p>
          ) : (
            visibleStores.map((s) => (
              <OptionRow key={s.id} checked={storeIds.includes(s.id)} onChange={() => setStores(toggle(storeIds, s.id))}>
                {s.name}
              </OptionRow>
            ))
          )}
        </div>
        {storeIds.length ? (
          <button
            type="button"
            onClick={() => setStores([])}
            className="mt-1 px-2 text-xs font-medium text-brand-700 hover:underline"
          >
            Unselect all stores
          </button>
        ) : null}
      </MultiSelect>

      <MultiSelect label="Products" selectedCount={productNames.length}>
        {!storeIds.length ? (
          <p className="px-2 py-1.5 text-sm text-slate-400">Select one or more stores first.</p>
        ) : (
          <>
            <input
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Search products…"
              className={inputClass}
            />
            <div className="max-h-72 overflow-auto">
              {loadingProducts && !rows.length ? (
                <p className="px-2 py-1.5 text-sm text-slate-400">Loading…</p>
              ) : !rows.length ? (
                <p className="px-2 py-1.5 text-sm text-slate-400">No products in this view.</p>
              ) : (
                rows.map((p) => (
                  <OptionRow
                    key={p.product_name}
                    checked={productNames.includes(p.product_name)}
                    onChange={() => onChange({ storeIds, productNames: toggle(productNames, p.product_name) })}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate" title={p.product_name}>
                        {p.product_name}
                      </span>
                      {p.order_count != null ? (
                        <span className="shrink-0 text-xs text-slate-400">{p.order_count}</span>
                      ) : null}
                    </span>
                  </OptionRow>
                ))
              )}
            </div>
            {truncated ? (
              <p className="mt-1 px-2 text-xs text-slate-400">Showing the top 500 - search to narrow.</p>
            ) : null}
            {productNames.length ? (
              <button
                type="button"
                onClick={() => onChange({ storeIds, productNames: [] })}
                className="mt-1 px-2 text-xs font-medium text-brand-700 hover:underline"
              >
                Unselect all products
              </button>
            ) : null}
          </>
        )}
      </MultiSelect>
    </>
  );
}
