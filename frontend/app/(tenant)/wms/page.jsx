"use client";

import { useCallback, useEffect, useState } from "react";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import StockAdjustModal from "../../../components/wms/StockAdjustModal";
import NewStockItemModal from "../../../components/wms/NewStockItemModal";
import WarehouseSetupCard from "../../../components/wms/WarehouseSetupCard";

const STOCK_FILTERS = [
  { value: "", label: "All Stock" },
  { value: "negative", label: "Negative" },
  { value: "low", label: "Low Stock" },
];

function SummaryCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-slate-900",
    danger: "text-red-600",
    warning: "text-amber-600",
  };
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
    </div>
  );
}

export default function WmsPage() {
  const [warehouses, setWarehouses] = useState([]);
  const [stock, setStock] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adjusting, setAdjusting] = useState(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");

  const loadWarehouses = useCallback(async () => {
    try {
      setWarehouses(await wmsService.listWarehouses());
    } catch {
      // Non-fatal - the setup card below handles the "none yet" case.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [stockData, summaryData] = await Promise.all([
        wmsService.listStock({
          page,
          page_size: pageSize,
          search: appliedSearch || undefined,
          stock_filter: stockFilter || undefined,
        }),
        wmsService.stockSummary(),
      ]);
      setStock(stockData.results || []);
      setCount(stockData.count || 0);
      setSummary(summaryData);
    } catch (err) {
      setError(err.message || "Failed to load stock");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch, stockFilter]);

  async function onImportSkus() {
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const result = await wmsService.importSkusFromOrders();
      setNotice(
        result.created > 0
          ? `Imported ${result.created} SKU${result.created === 1 ? "" : "s"} at zero quantity — enter real counts with Adjust.`
          : `Nothing new to import — all ${result.total_skus} SKUs from your orders are already listed.`
      );
      await load();
    } catch (err) {
      setError(err.message || "Failed to import SKUs");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    loadWarehouses();
  }, [loadWarehouses]);

  useEffect(() => {
    load();
  }, [load]);

  const hasWarehouse = warehouses.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock levels across your warehouses. Negative balances mean orders shipped units the
            warehouse didn&apos;t have.
          </p>
        </div>
        {hasWarehouse ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onImportSkus} disabled={importing}>
              {importing ? "Importing…" : "Import SKUs from Orders"}
            </Button>
            <Button onClick={() => setNewItemOpen(true)}>Add Stock Item</Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      {!hasWarehouse ? (
        <WarehouseSetupCard onCreated={loadWarehouses} />
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard label="Total SKUs" value={summary.total_skus ?? 0} />
            <SummaryCard label="Negative Stock" value={summary.negative_count ?? 0} tone="danger" />
            <SummaryCard label="Low Stock" value={summary.low_count ?? 0} tone="warning" />
          </div>

          {summary.negative_count > 0 ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
              <span className="text-sm text-red-700">
                <strong>{summary.negative_count}</strong>{" "}
                {summary.negative_count === 1 ? "item is" : "items are"} in negative stock — orders
                were processed beyond available inventory. Receive stock or adjust quantities to
                clear this.
              </span>
              <button
                type="button"
                onClick={() => {
                  setStockFilter("negative");
                  setPage(1);
                }}
                className="ml-auto shrink-0 text-sm font-medium text-red-700 underline"
              >
                View
              </button>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(search);
                setPage(1);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU or product"
                className="w-64 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>

            <div className="flex gap-1.5">
              {STOCK_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => {
                    setStockFilter(f.value);
                    setPage(1);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                    stockFilter === f.value
                      ? "border-brand-800 bg-brand-800 text-white"
                      : "border-surface-border bg-white text-slate-600 hover:bg-surface"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-surface-border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">Warehouse</th>
                  <th className="px-3 py-2 text-right">On Hand</th>
                  <th className="px-3 py-2 text-right">Reorder At</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && stock.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : stock.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      No stock items yet. Add one, or they&apos;ll be created automatically the
                      first time an order consumes a SKU.
                    </td>
                  </tr>
                ) : (
                  stock.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-b border-surface-border last:border-0 ${
                        item.is_negative ? "bg-red-50/60" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800">{item.sku}</td>
                      <td className="px-3 py-2 text-slate-600">{item.product_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{item.warehouse_name}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          item.is_negative ? "text-red-600" : "text-slate-900"
                        }`}
                      >
                        {item.quantity}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {item.reorder_level}
                      </td>
                      <td className="px-3 py-2">
                        {item.is_negative ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                            Negative
                          </span>
                        ) : item.is_low ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            Low
                          </span>
                        ) : (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                            In Stock
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setAdjusting(item)}
                          className="text-sm font-medium text-brand-700 hover:underline"
                        >
                          Adjust
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            count={count}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}

      <StockAdjustModal
        item={adjusting}
        onClose={() => setAdjusting(null)}
        onAdjusted={async () => {
          setAdjusting(null);
          await load();
        }}
      />
      <NewStockItemModal
        open={newItemOpen}
        warehouses={warehouses}
        onClose={() => setNewItemOpen(false)}
        onCreated={async () => {
          setNewItemOpen(false);
          await load();
        }}
      />
    </div>
  );
}
