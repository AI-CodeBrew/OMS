"use client";

import { useCallback, useEffect, useState } from "react";
import inventoryAdminService from "../../../../services/inventoryAdminService";
import Button from "../../../../components/shared/Button";
import Pagination from "../../../../components/shared/Pagination";
import InventoryItemDetailModal from "../../../../components/wms/InventoryItemDetailModal";

// The super admin's Inventory: the same table a store sees on its own
// Inventory page, for every store at once - Store first on each row. Search
// a SKU and every store that stocks it shows its own row. Read only - stock
// is adjusted from the store's own Inventory page.

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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await inventoryAdminService.list({
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
        <h1 className="mr-2 text-2xl font-semibold text-slate-900" title="Every store's inventory. Search a SKU to see it in every store that stocks it.">
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
              <th className={TH_LEFT}>Store</th>
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
              rows.map((item) => (
                <tr key={item.id} className="border-b border-surface-border last:border-0 hover:bg-surface">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">{item.store_name}</td>
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
                  <UnitsAndOrders units={item.delivered} orders={item.delivered_orders} />
                  <UnitsAndOrders units={item.dispatched} orders={item.dispatched_orders} />
                  <UnitsAndOrders units={item.failed_delivery} orders={item.failed_delivery_orders} />
                  <UnitsAndOrders units={item.return_in_transit} orders={item.return_in_transit_orders} />
                  <td className="px-3 py-1.5 text-right tabular-nums">{item.damaged_lost}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => setViewing(item)}
                      aria-label={`Details for ${item.sku || item.product_name}`}
                      title="Details"
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

      <InventoryItemDetailModal
        item={viewing}
        onClose={() => setViewing(null)}
        loadReport={(id) => inventoryAdminService.report(id)}
      />
    </div>
  );
}
