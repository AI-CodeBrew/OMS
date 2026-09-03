"use client";

import { useCallback, useEffect, useState } from "react";
import ordersService from "../../../../services/ordersService";
import wmsService from "../../../../services/wmsService";
import Button from "../../../../components/shared/Button";
import Pagination from "../../../../components/shared/Pagination";
import DateRangeFilter from "../../../../components/orders/DateRangeFilter";
import ScanPanel from "../../../../components/wms/ScanPanel";
import { SEARCH_FIELDS } from "../../../../components/orders/statusConfig";

// The queue is just the OMS pipeline read from the warehouse's side: an
// order lands here the moment it reaches Ready to Pick, and leaves as soon
// as it is packed into Awaiting Dispatched. There is no separate packing
// record to keep in step.
const TABS = [
  { value: "ready_to_pick", label: "To Pack" },
  { value: "awaiting_dispatched", label: "Packed" },
];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function PackingPage() {
  const [statusTab, setStatusTab] = useState("ready_to_pick");
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("order_number");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await ordersService.list({
        status: statusTab,
        page,
        page_size: pageSize,
        search: appliedSearch || undefined,
        search_field: appliedSearch ? searchField : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setOrders(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load packing queue");
    } finally {
      setLoading(false);
    }
  }, [statusTab, page, pageSize, appliedSearch, searchField, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [orders]);

  const selectedRows = orders.filter((o) => selectedIds.has(o.id));
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
  const packable = statusTab === "ready_to_pick";

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function packOne(orderNumber) {
    setError("");
    setNotice("");
    try {
      const result = await wmsService.scanPacked({ orderNumber });
      if (result.success) {
        setNotice(`${orderNumber} — packed, moved to Awaiting Dispatched`);
        await load();
      } else {
        setError(`${orderNumber} — ${result.reason}`);
      }
    } catch (err) {
      setError(err.message || "Pack failed");
    }
  }

  async function runBulkPack() {
    setBulkBusy(true);
    setError("");
    setNotice("");
    try {
      const { results = [] } = await wmsService.bulkPack({
        orderNumbers: selectedRows.map((o) => o.order_number),
      });
      const packed = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      setNotice(
        `Packed ${packed.length} of ${results.length}.` +
          (failed.length
            ? ` Skipped: ${failed.map((f) => `${f.order_number} (${f.reason})`).join(", ")}`
            : "")
      );
      await load();
    } catch (err) {
      setError(err.message || "Bulk pack failed");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Packing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Orders picked and waiting to be packed. Scan a parcel once it is packed to move it into
            Awaiting Dispatched, ready for the courier.
          </p>
        </div>
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApplyDateRange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
            setPage(1);
          }}
          onClearDateRange={() => {
            setDateFrom("");
            setDateTo("");
            setPage(1);
          }}
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <ScanPanel
          title="Scan packed parcel"
          hint="Only orders sitting in Ready to Pick can be packed. A repeat scan of the same parcel is ignored."
          actionLabel="Mark Packed"
          fieldLabel="Tracking number"
          onScan={(trackingNumber) => wmsService.scanPacked({ trackingNumber })}
          renderSuccess={() => "Packed — moved to Awaiting Dispatched"}
          onAfterSuccess={load}
        />

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5">
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setStatusTab(tab.value);
                    setPage(1);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                    statusTab === tab.value
                      ? "border-brand-800 bg-brand-800 text-white"
                      : "border-surface-border bg-white text-slate-600 hover:bg-surface"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

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
                placeholder="Search orders"
                className="w-52 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <select
                value={searchField}
                onChange={(e) => setSearchField(e.target.value)}
                className="rounded-md border border-surface-border px-2 py-2 text-sm outline-none focus:border-brand-500"
              >
                {SEARCH_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary">
                Search
              </Button>
              {appliedSearch ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setAppliedSearch("");
                    setPage(1);
                  }}
                  className="text-sm text-slate-500 underline"
                >
                  Clear
                </button>
              ) : null}
            </form>
          </div>

          {packable && selectedRows.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
              <span className="text-sm font-medium text-brand-900">
                {selectedRows.length} selected
              </span>
              <Button onClick={runBulkPack} loading={bulkBusy}>
                Mark Packed
              </Button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-sm text-slate-600 underline"
              >
                Clear selection
              </button>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  {packable ? (
                    <th className="px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() =>
                          setSelectedIds(allSelected ? new Set() : new Set(orders.map((o) => o.id)))
                        }
                        disabled={orders.length === 0}
                        aria-label="Select all"
                      />
                    </th>
                  ) : null}
                  <th className="px-3 py-2 text-left">Order</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">City</th>
                  <th className="px-3 py-2 text-left">Courier</th>
                  <th className="px-3 py-2 text-left">Tracking</th>
                  <th className="px-3 py-2 text-left">Placed</th>
                  <th className="px-3 py-2 text-left">Scanned By</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  {packable ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                      {packable
                        ? "Nothing waiting to be packed."
                        : "Nothing packed in this range yet."}
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b border-surface-border last:border-0">
                      {packable ? (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(order.id)}
                            onChange={() => toggleRow(order.id)}
                            aria-label={`Select ${order.order_number}`}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-2 font-medium text-slate-800">{order.order_number}</td>
                      <td className="px-3 py-2 text-slate-600">{order.customer_name}</td>
                      <td className="px-3 py-2 text-slate-600">{order.city || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{order.courier_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{order.tracking_number || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDate(order.placed_at || order.created_at)}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{order.packed_by_email || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {order.total_amount}
                      </td>
                      {packable ? (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={bulkBusy}
                            onClick={() => packOne(order.order_number)}
                            className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                          >
                            Mark Packed
                          </button>
                        </td>
                      ) : null}
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
        </div>
      </div>
    </div>
  );
}
