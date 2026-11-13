"use client";

import { useCallback, useEffect, useState } from "react";
import inventoryAdminService from "../../../../services/inventoryAdminService";
import { useRememberedData, useRememberedState } from "../../../../lib/pageMemory";
import Button from "../../../../components/shared/Button";
import Pagination from "../../../../components/shared/Pagination";
import Modal from "../../../../components/shared/Modal";
import InventoryItemDetailModal from "../../../../components/wms/InventoryItemDetailModal";

// The super admin's Inventory: one row per SKU over every store - each
// number the sum of all stores holding it. Clicking a SKU opens a
// popup with its store rows (same columns, per store and warehouse). Read
// only - stock is adjusted from the store's own Inventory page.

const ACTIVITY_CARDS = [
  { value: "", key: "total", label: "Total SKUs" },
  { value: "active", key: "active", label: "Active SKUs", hint: "In stock, and ordered" },
  { value: "inactive", key: "inactive", label: "Inactive SKUs", hint: "In stock, no orders" },
  { value: "out_of_stock", key: "out_of_stock", label: "Out of Stock", hint: "None in stock" },
];

const TH_LEFT = "whitespace-nowrap px-3 py-2.5 text-left align-middle";
const TH_NUM = "whitespace-nowrap px-3 py-2.5 text-right align-middle";

function SummaryCard({ label, value, hint, active, onClick }) {
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
      <span className="text-lg font-semibold tabular-nums text-slate-900">{value}</span>
    </button>
  );
}

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

// The number cells shared by a SKU row and its store rows.
function NumberCells({ row }) {
  return (
    <>
      <td className="px-3 py-1.5 text-right tabular-nums">{row.order_placed ?? 0}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{row.total_inbound}</td>
      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-900">{row.available}</td>
      <UnitsAndOrders units={row.delivered} orders={row.delivered_orders} />
      <UnitsAndOrders units={row.dispatched} orders={row.dispatched_orders} />
      <UnitsAndOrders units={row.failed_delivery} orders={row.failed_delivery_orders} />
      <UnitsAndOrders units={row.return_in_transit} orders={row.return_in_transit_orders} />
      <td className="px-3 py-1.5 text-right tabular-nums">{row.damaged_lost}</td>
    </>
  );
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function AdminInventoryPage() {
  // Back brings the page back as it was left - same page, size, search
  // and filter, its last rows shown at once while fresh ones load.
  const { recall, remember } = useRememberedData("inventory");
  const [rows, setRows] = useState(() => recall()?.rows || []);
  const [count, setCount] = useState(() => recall()?.count || 0);
  const [summary, setSummary] = useState(() => recall()?.summary || {});
  const [page, setPage] = useRememberedState("page", 1);
  const [pageSize, setPageSize] = useRememberedState("pageSize", 25);
  const [search, setSearch] = useRememberedState("search", "");
  const [appliedSearch, setAppliedSearch] = useRememberedState("appliedSearch", "");
  const [activity, setActivity] = useRememberedState("activity", "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null);
  // The SKU whose stores are shown in the popup.
  const [storesOf, setStoresOf] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await inventoryAdminService.list({
        group: "sku",
        page,
        page_size: pageSize,
        search: appliedSearch || undefined,
        activity: activity || undefined,
      });
      setRows(data.results || []);
      setCount(data.count || 0);
      setSummary(data.summary || {});
      remember({ rows: data.results || [], count: data.count || 0, summary: data.summary || {} });
    } catch (err) {
      setError(err.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch, activity, remember]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-semibold text-slate-900" title="One row per SKU over every store. Open a SKU to see each store's stock.">
          Inventory
        </h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(search.trim());
            setPage(1);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none"
        >
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // Emptying the box brings the full list back.
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
      </div>

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIVITY_CARDS.map((card) => (
          <SummaryCard
            key={card.key}
            label={card.label}
            value={summary[card.key] ?? 0}
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
              <th className={TH_LEFT}>Store / Warehouse</th>
              <th className={TH_NUM} title="Ordered on purchase orders for this warehouse, not received yet">
                Order Placed
              </th>
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
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  {activity || appliedSearch ? "No items here." : "No store has stock items yet."}
                </td>
              </tr>
            ) : (
              rows.map((group) => (
                    <tr key={group.key} className="border-b border-surface-border last:border-0 hover:bg-surface">
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">
                        <button
                          type="button"
                          onClick={() => setStoresOf(group)}
                          title="Show which stores have this SKU"
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {group.sku || "—"}
                        </button>
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-slate-600" title={group.product_name}>
                        {group.product_name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => setStoresOf(group)}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          {group.store_count} {group.store_count === 1 ? "Store" : "Stores"}
                        </button>
                      </td>
                      <NumberCells row={group} />
                      <td className="px-2 py-1" />
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
        itemLabel="SKUs"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {/* One SKU's stores - the same columns, per store and warehouse. */}
      <Modal
        open={Boolean(storesOf)}
        onClose={() => setStoresOf(null)}
        width="max-w-6xl"
        title={
          storesOf ? (
            <span>
              {storesOf.sku || "—"}
              <span className="ml-2 font-normal text-slate-500">{storesOf.product_name}</span>
              <span className="ml-2 text-xs font-normal text-slate-400">
                {storesOf.store_count} {storesOf.store_count === 1 ? "Store" : "Stores"}
              </span>
            </span>
          ) : ""
        }
      >
        {storesOf ? (
          <div className="overflow-x-auto rounded-lg border border-surface-border">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={TH_LEFT}>Store / Warehouse</th>
                  <th className={TH_NUM}>Order Placed</th>
                  <th className={TH_NUM}>Total Inbound</th>
                  <th className={TH_NUM}>Available</th>
                  <th className={TH_NUM}>Delivered</th>
                  <th className={TH_NUM}>Dispatched</th>
                  <th className={TH_NUM}>Failed Delivery</th>
                  <th className={TH_NUM}>Return in Transit</th>
                  <th className={TH_NUM}>Damaged/Lost</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {storesOf.stores.map((item) => (
                  <tr key={item.id} className="border-b border-surface-border last:border-0 hover:bg-surface">
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <div className="font-medium text-slate-800">{item.store_name}</div>
                      <div className="text-[11px] text-slate-400">{item.warehouse_name}</div>
                    </td>
                    <NumberCells row={item} />
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setViewing(item)}
                        aria-label={`Details for ${item.sku || item.product_name} in ${item.store_name}`}
                        title="Details"
                        className="rounded p-1 text-slate-500 hover:bg-white hover:text-brand-700"
                      >
                        <EyeIcon />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-surface-border bg-surface font-medium">
                  <td className="px-3 py-1.5 text-slate-700">Total</td>
                  <NumberCells row={storesOf} />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>

      <InventoryItemDetailModal
        item={viewing}
        onClose={() => setViewing(null)}
        loadReport={(id) => inventoryAdminService.report(id)}
      />
    </div>
  );
}
