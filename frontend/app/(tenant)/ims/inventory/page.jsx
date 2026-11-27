"use client";

import usePageAccess from "../../../../lib/usePageAccess";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import wmsService from "../../../../services/wmsService";
import useLoadingStore from "../../../../store/loadingStore";
import { onViewCacheClear, viewCacheScope } from "../../../../lib/viewCache";
import Button from "../../../../components/shared/Button";
import SearchBox from "../../../../components/shared/SearchBox";
import Pagination from "../../../../components/shared/Pagination";
import StockAdjustModal from "../../../../components/wms/StockAdjustModal";
import WarehouseSetupCard from "../../../../components/wms/WarehouseSetupCard";
import ShopifyPushModal from "../../../../components/wms/ShopifyPushModal";
import InventoryItemDetailModal from "../../../../components/wms/InventoryItemDetailModal";
import InventoryImportModal from "../../../../components/wms/InventoryImportModal";

// The cards (backend: wms.services.inventory_activity) - each also filters
// the table. Active: in stock and ordered. Inactive: in stock, never
// ordered. Out of stock: none on hand.
// A status column's cell: units, with how many orders they're on below.
function UnitsAndOrders({ units, orders }) {
  return (
    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
      <div>{units ?? 0}</div>
      <div className="text-[11px] text-slate-400">
        {orders ?? 0} {orders === 1 ? "order" : "orders"}
      </div>
    </td>
  );
}

const ACTIVITY_CARDS = [
  { value: "", key: "total", label: "Total SKUs", tone: "default" },
  { value: "active", key: "active", label: "Active SKUs", tone: "success", hint: "In stock, and ordered" },
  { value: "inactive", key: "inactive", label: "Inactive SKUs", tone: "warning", hint: "In stock, no orders" },
  { value: "out_of_stock", key: "out_of_stock", label: "Out of Stock", tone: "danger", hint: "None in stock" },
];

// Switching a card or a page is instant (user, 2026-11-27: the card changed
// first, the old card's rows stayed, and only then the new ones loaded). The
// server works out every row of a tab for any card anyway, so one request
// fetches the whole tab, and its cards and pages are picked here with no
// request. Kept for this browser tab per store (viewCacheScope), so coming
// back, or to the other tab, shows the last rows at once and refreshes them
// quietly. A tab with more rows than one request carries (FULL_PAGE) falls
// back to the server's paging per card; its table empties while it loads,
// so it never shows the old card's rows.
const FULL_PAGE = 500; // the server's page_size cap
const FRESH_MS = 30000; // shown from the cache without a refresh while this young
const inventoryCache = new Map();
const prefetching = new Set();
// Logging out forgets it, like the Orders / Dashboard cache.
onViewCacheClear(() => inventoryCache.clear());

function tabKey(tab, search) {
  return `${viewCacheScope()}|${tab}|${search}`;
}

function pagedKey(tab, search, activity, page, pageSize) {
  return `${tabKey(tab, search)}|${activity}|${page}|${pageSize}`;
}

// Only under the store / login it was fetched for - a reply that comes back
// after a switch is never kept for the other one.
function remember(key, entry) {
  if (!key.startsWith(`${viewCacheScope()}|`)) return;
  if (inventoryCache.size > 60) inventoryCache.clear();
  inventoryCache.set(key, { ...entry, at: Date.now() });
}

function tabEntry(data, paged) {
  const rows = data.results || [];
  const count = data.count || 0;
  return { full: !paged, rows, count, summary: data.summary || {} };
}

// The other tab, fetched in the background so clicking it is instant too.
async function prefetchTab(tab, search) {
  const key = tabKey(tab, search);
  if (inventoryCache.has(key) || prefetching.has(key)) return;
  prefetching.add(key);
  try {
    const data = await wmsService.inventoryOverview({
      page: 1,
      page_size: FULL_PAGE,
      search: search || undefined,
      sku: tab,
    });
    const entry = tabEntry(data, false);
    remember(key, entry.count > entry.rows.length ? { full: false } : entry);
  } catch {
    // Only a speed-up - the tab loads itself when clicked.
  } finally {
    prefetching.delete(key);
  }
}

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
  const { canWrite } = usePageAccess("ims.inventory");
  const beginLoading = useLoadingStore((s) => s.begin);
  const endLoading = useLoadingStore((s) => s.end);
  const [warehouses, setWarehouses] = useState([]);
  // What the table shows: {key, tab, search, full, rows, count, summary}.
  // full: rows is the whole tab (every card) - the card and page are picked
  // below. Otherwise rows is the server's page of the card. null: loading a
  // tab / card not seen yet.
  const [table, setTable] = useState(() => {
    const key = tabKey("with", "");
    const cached = inventoryCache.get(key);
    return cached?.rows ? { key, tab: "with", search: "", ...cached } : null;
  });
  // The tabs' counts - the same for both tabs, so kept while the other loads.
  const [tabCounts, setTabCounts] = useState(() => table?.summary || {});
  // Push to Shopify's pending count.
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activity, setActivity] = useState("");
  // "with": products that have a SKU (the inventory); "missing": the No SKUs
  // tab - products with no SKU yet, counted by their orders' product name.
  // A PO line naming one moves it over (backend wms.services.adopt_no_sku_product).
  const [skuTab, setSkuTab] = useState("with");
  const [loading, setLoading] = useState(() => !table);
  const [error, setError] = useState("");
  const [adjusting, setAdjusting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [pushOpen, setPushOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // The table as a CSV - with the search and card picked here.
  async function onExport() {
    setExporting(true);
    setError("");
    try {
      await wmsService.exportInventory({
        search: appliedSearch || undefined,
        activity: activity || undefined,
        sku: skuTab,
      });
    } catch (err) {
      setError(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const loadWarehouses = useCallback(async () => {
    try {
      setWarehouses(await wmsService.listWarehouses());
    } catch {
      // Non-fatal - the setup card below handles the "none yet" case.
    }
  }, []);

  // Push to Shopify's pending count - apart from the table, so it never
  // holds the rows back.
  const loadPushCount = useCallback(async () => {
    try {
      setSummary(await wmsService.stockSummary());
    } catch {
      // Non-fatal - the button just shows no count.
    }
  }, []);

  // load() reads what's picked now from here, so a card / page click (picked
  // from the tab's rows) doesn't make a new load.
  const picked = useRef({});
  picked.current = { skuTab, appliedSearch, activity, page, pageSize };
  // Per view: the newest request's number (an older reply never overwrites
  // a newer one) and which views have a request on the way.
  const latestRequest = useRef(new Map());
  const requestSeq = useRef(0);
  const inflight = useRef(new Set());

  const show = useCallback((entry) => {
    setTable(entry);
    setTabCounts({ with_sku: entry.summary?.with_sku, no_sku: entry.summary?.no_sku });
  }, []);

  // The table for what's picked: from the cache at once when it has it
  // (refreshed quietly unless just fetched), else fetched. force: after a
  // change here - always fetched, with the rows kept on screen meanwhile.
  const load = useCallback(
    async ({ force = false } = {}) => {
      const { skuTab: tab, appliedSearch: search, activity: card, page: pg, pageSize: size } = picked.current;
      const tKey = tabKey(tab, search);
      const known = inventoryCache.get(tKey);
      const paged = Boolean(known && !known.full);
      const key = paged ? pagedKey(tab, search, card, pg, size) : tKey;
      // Its reply is shown only if this view is still the one picked - a
      // click elsewhere meanwhile leaves it in the cache for later.
      const stillPicked = () => {
        const now = picked.current;
        return (
          now.skuTab === tab &&
          now.appliedSearch === search &&
          (!paged || (now.activity === card && now.page === pg && now.pageSize === size))
        );
      };
      // Already on the way (a quick click back): that reply will show it.
      if (!force && inflight.current.has(key)) return;
      const seq = ++requestSeq.current;
      latestRequest.current.set(key, seq);
      const isLatest = () => latestRequest.current.get(key) === seq;
      const cached = paged ? inventoryCache.get(key) : known;
      // What these rows are for - the table shows them only while that is
      // what's picked (tableMatches below).
      const meta = { key, tab, search, card, page: pg, pageSize: size };
      setError("");
      if (!force && cached?.rows) {
        show({ ...meta, ...cached });
        setLoading(false);
        if (Date.now() - cached.at < FRESH_MS) {
          if (!paged && !search) prefetchTab(tab === "with" ? "missing" : "with", "");
          return;
        }
      } else if (!force) {
        setLoading(true);
      }
      inflight.current.add(key);
      let retry = false;
      try {
        const data = await wmsService.inventoryOverview(
          paged
            ? { page: pg, page_size: size, search: search || undefined, activity: card || undefined, sku: tab }
            : { page: 1, page_size: FULL_PAGE, search: search || undefined, sku: tab }
        );
        const entry = tabEntry(data, paged);
        if (!paged && entry.count > entry.rows.length) {
          // Too many for one request - this tab pages on the server, per
          // card: fetched again that way below.
          remember(tKey, { full: false });
          retry = stillPicked();
        } else if (isLatest()) {
          remember(key, entry);
          if (stillPicked()) {
            show({ ...meta, ...entry, at: Date.now() });
            setLoading(false);
            if (!paged && !search) prefetchTab(tab === "with" ? "missing" : "with", "");
          }
        }
      } catch (err) {
        if (isLatest() && stillPicked()) {
          setError(err.message || "Failed to load stock");
          setLoading(false);
        }
      } finally {
        inflight.current.delete(key);
      }
      if (retry) load({ force: true });
    },
    [show]
  );

  // After a change here (stock adjusted, imported, pushed, synced): every
  // cached tab is out of date.
  const reload = useCallback(async () => {
    inventoryCache.clear();
    loadPushCount();
    await load({ force: true });
  }, [load, loadPushCount]);

  async function onSyncShopify() {
    if (!window.confirm("Click to confirm")) {
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
      await reload();
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
    loadPushCount();
  }, [loadPushCount]);

  // A tab or a search: its rows (from the cache at once when seen before).
  useEffect(() => {
    load();
  }, [load, skuTab, appliedSearch]);

  // A card or a page is picked from the tab's rows - a request only for a
  // tab too big for one request (paged on the server).
  const pagedTable = Boolean(table && !table.full);
  useEffect(() => {
    if (pagedTable) load();
    // Only a card / page / page size change - a tab change loads above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, page, pageSize]);

  // The table's rows are shown only for what's picked now - in the same
  // render as the click, so a new tab / card never shows the old one's
  // rows, not even for a moment; it shows Loading until its own come. A new
  // search in the same tab keeps the old rows, dimmed, meanwhile.
  const tableMatches =
    Boolean(table) &&
    table.tab === skuTab &&
    table.search === appliedSearch &&
    (table.full || (table.card === activity && table.page === page && table.pageSize === pageSize));
  const searching = Boolean(table) && !tableMatches && table.tab === skuTab && table.search !== appliedSearch;
  const shown = tableMatches || searching ? table : null;
  const busy = (loading || !tableMatches) && !error;

  // The rows on screen: the picked card's page of the tab's rows - or the
  // server's page, for a paged tab.
  const cardRows = useMemo(() => {
    if (!shown) return [];
    if (!shown.full) return shown.rows || [];
    return activity ? shown.rows.filter((r) => r.activity === activity) : shown.rows;
  }, [shown, activity]);
  const stock = shown?.full ? cardRows.slice((page - 1) * pageSize, page * pageSize) : cardRows;
  const count = shown ? (shown.full ? cardRows.length : shown.count) : 0;
  // The cards' counts (Total / Active / Inactive / Out of Stock) - none
  // while a tab not seen yet loads, rather than the other tab's.
  const activityCounts = shown?.summary || null;
  const searchSuggestions = useMemo(
    () => cardRows.flatMap((item) => [item.product_name, item.sku]),
    [cardRows]
  );

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
          // Searches as you type; the dropdown lists this tab's names / SKUs
          // containing the text.
          <SearchBox
            value={search}
            onChange={setSearch}
            onSearch={(term) => {
              setAppliedSearch(term);
              setPage(1);
            }}
            suggestions={searchSuggestions}
            placeholder="Search SKU or product"
            className="flex-1 sm:flex-none"
            inputClassName="w-full sm:w-60"
          />
        ) : null}
        {hasWarehouse ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onExport} loading={exporting}>
              Export
            </Button>
            {canWrite ? (
              <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import
            </Button>
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
              </>
            ) : null}
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
          <div className="mt-3 flex gap-1 border-b border-surface-border">
            {[
              { key: "with", label: "Inventory", count: tabCounts.with_sku, hint: "Products with a SKU" },
              {
                key: "missing",
                label: "No SKUs",
                count: tabCounts.no_sku,
                hint: "Products with no SKU yet - counted by their orders' product name. A PO with the product's name and a SKU moves it to Inventory.",
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                title={tab.hint}
                onClick={() => {
                  setSkuTab(tab.key);
                  setActivity("");
                  setPage(1);
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  skuTab === tab.key
                    ? "border-brand-800 text-brand-800"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
                <span
                  className={`ml-1.5 rounded-full px-1.5 text-[11px] font-semibold ${
                    tab.key === "missing" && tab.count ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {tab.count ?? 0}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACTIVITY_CARDS.map((card) => (
              <SummaryCard
                key={card.key}
                label={card.label}
                value={activityCounts ? activityCounts[card.key] ?? 0 : "…"}
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
                  <th className={TH_NUM} title="Ordered on purchase orders for this warehouse, not received yet">
                    Order Placed
                  </th>
                  <th className={TH_NUM} title="Good units received on purchase orders">
                    Total Inbound
                  </th>
                  <th className={TH_NUM} title="On the shelf - not yet booked with a courier">
                    Available
                  </th>
                  <th className={TH_NUM} title="Booked with a courier, not picked up yet (Assigning Courier) - already taken out of Available at booking">
                    Reserved for Dispatch
                  </th>
                  <th className={TH_NUM}>Delivered</th>
                  <th className={TH_NUM}>Dispatched</th>
                  <th className={TH_NUM}>Failed Delivery</th>
                  <th className={TH_NUM}>Return in Transit</th>
                  <th className={TH_NUM}>Damaged/Lost</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className={`transition-opacity ${busy && stock.length ? "opacity-50" : ""}`}>
                {busy && stock.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : stock.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-3 py-6 text-center text-slate-500">
                      {activity || appliedSearch
                        ? "No items here."
                        : skuTab === "missing"
                          ? "Every product has a SKU."
                          : "No stock items yet - Sync from Shopify, or receive a purchase order."}
                    </td>
                  </tr>
                ) : (
                  stock.map((item) => (
                    <tr
                      key={item.id}
                      role={canWrite ? "button" : undefined}
                      tabIndex={canWrite ? 0 : undefined}
                      title={canWrite ? "Click to adjust stock" : undefined}
                      onClick={() => canWrite && setAdjusting(item)}
                      onKeyDown={(e) => {
                        if (canWrite && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          setAdjusting(item);
                        }
                      }}
                      className="cursor-pointer border-b border-surface-border last:border-0 hover:bg-surface focus:outline-none focus-visible:bg-surface"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">
                        {item.sku || "—"}
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
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.order_placed ?? 0}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.total_inbound}</td>
                      <td
                        className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                          item.available < 0 ? "text-red-600" : "text-slate-900"
                        }`}
                      >
                        {item.available}
                      </td>
                      <UnitsAndOrders units={item.reserved} orders={item.reserved_orders} />
                      <UnitsAndOrders units={item.delivered} orders={item.delivered_orders} />
                      <UnitsAndOrders units={item.dispatched} orders={item.dispatched_orders} />
                      <UnitsAndOrders units={item.failed_delivery} orders={item.failed_delivery_orders} />
                      <UnitsAndOrders units={item.return_in_transit} orders={item.return_in_transit_orders} />
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
          await reload();
        }}
      />
      <ShopifyPushModal
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        onPushed={reload}
      />
      <InventoryItemDetailModal item={viewing} onClose={() => setViewing(null)} />
      <InventoryImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(result) => {
          setNotice(`Import done - ${result.update} updated, ${result.create} added.`);
          reload();
        }}
      />
    </div>
  );
}
