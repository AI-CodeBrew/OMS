"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import inventoryAdminService from "../../../../services/inventoryAdminService";
import Button from "../../../../components/shared/Button";
import Pagination from "../../../../components/shared/Pagination";
import InventoryItemDetailModal from "../../../../components/wms/InventoryItemDetailModal";

// The super admin's Inventory: one row per SKU over every store - each
// number the sum of all stores holding it. The arrow beside a SKU opens its
// store rows (same columns, per store and warehouse). Read only - stock is
// adjusted from the store's own Inventory page.

const ACTIVITY_CARDS = [
  { value: "", key: "total", label: "Total SKUs", tone: "default" },
  { value: "active", key: "active", label: "Active SKUs", tone: "success", hint: "In stock, and ordered" },
  { value: "inactive", key: "inactive", label: "Inactive SKUs", tone: "warning", hint: "In stock, no orders" },
  { value: "out_of_stock", key: "out_of_stock", label: "Out of Stock", tone: "danger", hint: "None in stock" },
];

const ACTIVITY_DOT = {
  active: "bg-green-500",
  inactive: "bg-amber-400",
  out_of_stock: "bg-red-500",
};

const TH_LEFT = "whitespace-nowrap px-3 py-2.5 text-left align-middle";
const TH_NUM = "whitespace-nowrap px-3 py-2.5 text-right align-middle";

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

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// The number cells shared by a SKU row and its store rows.
function NumberCells({ row }) {
  return (
    <>
      <td className="px-3 py-1.5 text-right tabular-nums">{row.order_placed ?? 0}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{row.total_inbound}</td>
      <td
        className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
          row.available < 0 ? "text-red-600" : "text-slate-900"
        }`}
      >
        {row.available}
      </td>
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
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activity, setActivity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null);
  // SKU rows opened to show their stores (by row key).
  const [expanded, setExpanded] = useState(() => new Set());

  function toggle(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
    } catch (err) {
      setError(err.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch, activity]);

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
              rows.map((group) => {
                const open = expanded.has(group.key);
                return (
                  <Fragment key={group.key}>
                    <tr className="border-b border-surface-border last:border-0 hover:bg-surface">
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggle(group.key)}
                            aria-expanded={open}
                            aria-label={open ? "Hide Stores" : "Show Stores"}
                            title={open ? "Hide Stores" : "Show Stores"}
                            className="rounded p-0.5 text-slate-500 hover:bg-white hover:text-brand-700"
                          >
                            <ChevronIcon open={open} />
                          </button>
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${ACTIVITY_DOT[group.activity] || "bg-slate-300"}`}
                            title={ACTIVITY_CARDS.find((c) => c.value === group.activity)?.label || ""}
                          />
                          {group.sku || "—"}
                        </span>
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-slate-600" title={group.product_name}>
                        {group.product_name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(group.key)}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          {group.store_count} {group.store_count === 1 ? "Store" : "Stores"}
                        </button>
                      </td>
                      <NumberCells row={group} />
                      <td className="px-2 py-1" />
                    </tr>
                    {open
                      ? group.stores.map((item) => (
                          <tr key={item.id} className="border-b border-surface-border bg-slate-50/70 text-[13px]">
                            <td className="whitespace-nowrap py-1.5 pl-12 pr-3 text-slate-500">{item.sku || "—"}</td>
                            <td className="max-w-[260px] truncate px-3 py-1.5 text-slate-500" title={item.product_name}>
                              {item.product_name || "—"}
                            </td>
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
                        ))
                      : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        count={count}
        itemLabel="SKUs"
        maxPageSize={500}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      <InventoryItemDetailModal
        item={viewing}
        onClose={() => setViewing(null)}
        loadReport={(id) => inventoryAdminService.report(id)}
      />
    </div>
  );
}
