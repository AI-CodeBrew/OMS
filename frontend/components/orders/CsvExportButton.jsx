"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "../shared/Button";
import ordersService from "../../services/ordersService";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "orders";
}

/**
 * Export CSV - three ways, all the report's "All" columns:
 * - All Orders: every order the page shows now - its tab, dates, search
 *   and Filters (filterParams).
 * - Courier Wise: the same, for one courier (picked from the couriers those
 *   orders have, with their counts - backend f_courier).
 * - Selected Orders: just the ticked rows (selectedIds), whatever the
 *   filters.
 * The Smartlane upload template stays at the bottom.
 * allAndCourierOnly: just the first two (pages without ticking, e.g.
 * Critical Orders); filePrefix names the downloaded files.
 *
 * No global loadingStore here on purpose - a download is quiet; the inline
 * spinner is the only feedback.
 */
export default function CsvExportButton({ filterParams, selectedIds = [], allAndCourierOnly = false, filePrefix = "orders" }) {
  const [open, setOpen] = useState(false);
  const [showCouriers, setShowCouriers] = useState(false);
  const [couriers, setCouriers] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
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

  // The couriers of the orders on screen (with the page's filters, minus
  // any courier filter of its own), loaded when Courier Wise is opened.
  useEffect(() => {
    if (!open || !showCouriers) return undefined;
    let cancelled = false;
    setCouriers(null);
    const params = { ...filterParams, field: "f_courier" };
    delete params.f_courier;
    ordersService
      .filterOptions(params)
      .then((data) => !cancelled && setCouriers(data.results || []))
      .catch(() => !cancelled && setCouriers([]));
    return () => {
      cancelled = true;
    };
  }, [open, showCouriers, filterParams]);

  async function download(params, filename) {
    setExporting(true);
    setError("");
    setOpen(false);
    try {
      const blob = await ordersService.exportCsv(params);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Export failed - try again.");
    } finally {
      setExporting(false);
    }
  }

  const selectedCount = selectedIds.length;
  const itemClass =
    "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-surface disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={exporting}
        onClick={() => {
          setOpen((o) => !o);
          setShowCouriers(false);
        }}
        className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface disabled:opacity-60"
      >
        {exporting ? <Spinner className="text-slate-500" /> : null}
        Export CSV <span className="text-xs">▾</span>
      </button>
      {error ? <p className="absolute right-0 mt-1 whitespace-nowrap text-xs text-red-600">{error}</p> : null}

      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-surface-border bg-white p-1.5 shadow-lg">
          <button
            type="button"
            className={itemClass}
            onClick={() => download({ ...filterParams, template: "all" }, `${filePrefix}_${today()}.csv`)}
          >
            <span>
              <span className="block font-medium">All Orders</span>
              <span className="block text-xs text-slate-500">Everything shown, with your filters</span>
            </span>
          </button>

          <button type="button" className={itemClass} onClick={() => setShowCouriers((s) => !s)}>
            <span>
              <span className="block font-medium">Courier Wise</span>
              <span className="block text-xs text-slate-500">One courier&apos;s orders, with your filters</span>
            </span>
            <span className={`text-xs text-slate-400 transition-transform ${showCouriers ? "rotate-90" : ""}`}>▶</span>
          </button>
          {showCouriers ? (
            <div className="mx-1 mb-1 max-h-56 overflow-y-auto rounded-md border border-surface-border bg-surface/60 p-1">
              {couriers === null ? (
                <p className="px-3 py-2 text-xs text-slate-500">Loading couriers…</p>
              ) : couriers.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-500">No couriers in these orders.</p>
              ) : (
                couriers.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-white"
                    onClick={() =>
                      download(
                        { ...filterParams, template: "all", f_courier: JSON.stringify([c.value]) },
                        `${filePrefix}_${slug(c.label)}_${today()}.csv`
                      )
                    }
                  >
                    <span className="truncate">{c.label}</span>
                    <span className="shrink-0 text-xs text-slate-400">{c.count}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}

          {allAndCourierOnly ? null : (
          <>
          <button
            type="button"
            className={itemClass}
            disabled={!selectedCount}
            onClick={() =>
              download({ template: "all", ids: JSON.stringify(selectedIds) }, `orders_selected_${today()}.csv`)
            }
          >
            <span>
              <span className="block font-medium">Selected Orders{selectedCount ? ` (${selectedCount})` : ""}</span>
              <span className="block text-xs text-slate-500">
                {selectedCount ? "Only the orders you ticked" : "Tick orders in the list first"}
              </span>
            </span>
          </button>

          <div className="my-1 border-t border-surface-border" />
          <button
            type="button"
            className={`${itemClass} text-xs text-slate-500`}
            onClick={() => download({ ...filterParams, template: "smartlane" }, "orders_smartlane.csv")}
          >
            Smartlane Template
          </button>
          </>
          )}
        </div>
      ) : null}
    </div>
  );
}
