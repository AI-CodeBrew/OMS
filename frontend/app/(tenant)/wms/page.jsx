"use client";

import { useCallback, useEffect, useState } from "react";
import wmsService from "../../../services/wmsService";
import useLoadingStore from "../../../store/loadingStore";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import StockAdjustModal from "../../../components/wms/StockAdjustModal";
import WarehouseSetupCard from "../../../components/wms/WarehouseSetupCard";
import ShopifyPushModal from "../../../components/wms/ShopifyPushModal";
import InventoryItemDetailModal from "../../../components/wms/InventoryItemDetailModal";

// The cards (backend: wms.services.inventory_activity) - each also filters
// the table. Active: in stock and ordered. Inactive: in stock, never
// ordered. Out of stock: ordered, none on hand.
const ACTIVITY_CARDS = [
  { value: "", key: "total", label: "Total SKUs", tone: "default" },
  { value: "active", key: "active", label: "Active SKUs", tone: "success", hint: "In stock, and ordered" },
  { value: "inactive", key: "inactive", label: "Inactive SKUs", tone: "warning", hint: "In stock, no orders" },
  { value: "out_of_stock", key: "out_of_stock", label: "Out of Stock", tone: "danger", hint: "Ordered, none in stock" },
];

const ACTIVITY_DOT = {
  active: "bg-green-500",
  inactive: "bg-amber-400",
  out_of_stock: "bg-red-500",
};

function SummaryCard({ label, value, tone = "default", hint, active, onClick }) {
  const tones = {
    default: "text-slate-900",
    success: "text-green-600",
    danger: "text-red-600",
    warning: "text-amber-500",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`flex items-center justify-between gap-2 rounded-md border bg-white px-3 py-1.5 text-left transition ${
        active ? "border-brand-800 ring-1 ring-brand-800" : "border-surface-border hover:bg-surface"
      }`}
    >
      <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</span>
    </button>
  );
}

// One line per header, vertically centred - numbers right-aligned under
// right-aligned headers, with the same padding as their cells.
const TH_LEFT = "whitespace-nowrap px-3 py-2.5 text-left align-middle";
const TH_NUM = "whitespace-nowrap px-3 py-2.5 text-right align-middle";

function EyeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function WmsPage() {
  const beginLoading = useLoadingStore((s) => s.begin);
  const endLoading = useLoadingStore((s) => s.end);
  const [warehouses, setWarehouses] = useState([]);
  const [stock, setStock] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({});
  // The cards' counts (Total / Active / Inactive / Out of Stock).
  const [activityCounts, setActivityCounts] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activity, setActivity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adjusting, setAdjusting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [pushOpen, setPushOpen] = useState(false);

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
        wmsService.inventoryOverview({
          page,
          page_size: pageSize,
          search: appliedSearch || undefined,
          activity: activity || undefined,
        }),
        // Still read for Push to Shopify's pending count.
        wmsService.stockSummary(),
      ]);
      setStock(stockData.results || []);
      setCount(stockData.count || 0);
      setActivityCounts(stockData.summary || {});
      setSummary(summaryData);
    } catch (err) {
      setError(err.message || "Failed to load stock");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch, activity]);

  async function onSyncShopify() {
    if (!window.confirm("Sync stock from Shopify? Quantities here are replaced with Shopify's on-hand counts (plus any adjustments not yet pushed to Shopify).")) {
      return;
    }
    setSyncing(true);
    setError("");
    setNotice("");
    beginLoading("Syncing inventory from Shopify");
    try {
      const result = await wmsService.syncStockFromShopify();
      setNotice(
        `Synced ${result.total_skus} SKU${result.total_skus === 1 ? "" : "s"} from Shopify — ` +
          `${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged.`
      );
      await load();
    } catch (err) {
      setError(err.message || "Failed to sync from Shopify");
    } finally {
      setSyncing(false);
      endLoading();
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
      <div className="flex flex-wrap items-center gap-2">
        <h1
          className="mr-2 text-2xl font-semibold text-slate-900"
          title="Click a row to adjust its stock, or the eye for its details and report."
        >
          Inventory
        </h1>
        {hasWarehouse ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedSearch(search);
              setPage(1);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none"
          >
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Emptying the box (typing it away or the ✕) brings the
                // full list back without another Search click.
                if (!e.target.value.trim() && appliedSearch) {
                  setAppliedSearch("");
                  setPage(1);
                }
              }}
              placeholder="Search SKU or product"
              className="w-full min-w-0 rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500 sm:w-60"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        ) : null}
        {hasWarehouse ? (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onSyncShopify} loading={syncing}>
              Sync from Shopify
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPushOpen(true)}
              disabled={!summary.pending_shopify_count}
              title={
                summary.pending_shopify_count
                  ? `${summary.pending_shopify_count} ${
                      summary.pending_shopify_count === 1 ? "product has" : "products have"
                    } changes not yet on Shopify`
                  : "All name and stock changes made here are on Shopify"
              }
            >
              Push to Shopify
              {summary.pending_shopify_count > 0 ? (
                <span className="ml-1.5 rounded-full bg-brand-800 px-1.5 text-[11px] font-semibold leading-5 text-white">
                  {summary.pending_shopify_count}
                </span>
              ) : null}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      {!hasWarehouse ? (
        <WarehouseSetupCard onCreated={loadWarehouses} />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACTIVITY_CARDS.map((card) => (
              <SummaryCard
                key={card.key}
                label={card.label}
                value={activityCounts[card.key] ?? 0}
                tone={card.tone}
                hint={card.hint}
                active={activity === card.value}
                onClick={() => {
                  setActivity(card.value);
                  setPage(1);
                }}
              />
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-surface-border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={TH_LEFT}>SKU</th>
                  <th className={TH_LEFT}>Name</th>
                  <th className={TH_LEFT}>Warehouse</th>
                  <th className={TH_NUM} title="Good units received on purchase orders">
                    Total Inbound
                  </th>
                  <th className={TH_NUM} title="On the shelf - not yet booked with a courier">
                    Available
                  </th>
                  <th className={TH_NUM}>Delivered</th>
                  <th className={TH_NUM}>Dispatched</th>
                  <th className={TH_NUM}>Failed Delivery</th>
                  <th className={TH_NUM}>Return in Transit</th>
                  <th className={TH_NUM}>Damaged/Lost</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {loading && stock.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : stock.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                      {activity || appliedSearch
                        ? "No items here."
                        : "No stock items yet - Sync from Shopify, or receive a purchase order."}
                    </td>
                  </tr>
                ) : (
                  stock.map((item) => (
                    <tr
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      title="Click to adjust stock"
                      onClick={() => setAdjusting(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setAdjusting(item);
                        }
                      }}
                      className="cursor-pointer border-b border-surface-border last:border-0 hover:bg-surface focus:outline-none focus-visible:bg-surface"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${ACTIVITY_DOT[item.activity] || "bg-slate-300"}`}
                            title={ACTIVITY_CARDS.find((c) => c.value === item.activity)?.label || "No stock, no orders"}
                          />
                          {item.sku || "—"}
                        </span>
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-slate-600" title={item.product_name}>
                        {item.product_name || "—"}
                        {item.has_pending_shopify_push ? (
                          <span
                            title={item.shopify_push_error || "Changed here, not yet pushed to Shopify"}
                            className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              item.shopify_push_error
                                ? "bg-red-100 text-red-700"
                                : "bg-brand-100 text-brand-800"
                            }`}
                          >
                            {item.shopify_push_error ? "Push failed" : "Pending push"}
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{item.warehouse_name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.total_inbound}</td>
                      <td
                        className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                          item.available < 0 ? "text-red-600" : "text-slate-900"
                        }`}
                      >
                        {item.available}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.delivered}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.dispatched}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.failed_delivery}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.return_in_transit}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.damaged_lost}</td>
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewing(item);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label={`Details for ${item.sku || item.product_name}`}
                          title="Details and report"
                          className="rounded p-1 text-slate-500 hover:bg-white hover:text-brand-700"
                        >
                          <EyeIcon />
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
            itemLabel="products"
            maxPageSize={500}
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
      <ShopifyPushModal
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        onPushed={load}
      />
      <InventoryItemDetailModal item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
