"use client";

import { useCallback, useEffect, useState } from "react";
import ordersService from "../../../services/ordersService";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import ScanPanel from "../../../components/wms/ScanPanel";
import { SEARCH_FIELDS } from "../../../components/orders/statusConfig";

// Every returned order ends up in exactly one of these three buckets -
// "" (all) plus the two that make up a handled parcel: good (restocked)
// and bad (damaged, never touches inventory). Drives both the summary
// cards and the table filter, so a card click and its badge always agree.
const BUCKETS = [
  { value: "", label: "All" },
  { value: "awaiting", label: "Awaiting Scan" },
  { value: "received", label: "Received" },
  { value: "damaged", label: "Damaged" },
];

const CONDITION_OPTIONS = [
  { value: "good", label: "Good", tone: "success" },
  { value: "bad", label: "Bad", tone: "danger" },
];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function describeOutcome(entry) {
  if (entry.condition === "bad") return "Marked damaged — not added to inventory";
  const restocked = entry.restocked || [];
  if (restocked.length === 0) return "Received — no tracked SKUs";
  return `Received — ${restocked.map((r) => `${r.sku} +${r.quantity}`).join(", ")}`;
}

function bucketParams(bucket) {
  if (bucket === "awaiting") return { received: "no", return_condition: undefined };
  if (bucket === "received") return { received: "yes", return_condition: "good" };
  if (bucket === "damaged") return { received: "yes", return_condition: "bad" };
  return { received: undefined, return_condition: undefined };
}

function SummaryCard({ label, value, tone = "default", hint, active = false, onClick }) {
  const tones = {
    default: "text-slate-900",
    warning: "text-amber-600",
    success: "text-green-600",
    danger: "text-red-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border bg-white p-4 text-left transition ${
        active ? "border-brand-800 ring-1 ring-brand-800" : "border-surface-border hover:bg-surface"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
    </button>
  );
}

/**
 * Returns desk. Orders arrive here when the courier reports them returned
 * (status = "returned"). The parcel physically turns up later, and
 * scanning it here records what happened to it: "good" puts its stock
 * back (see wms.services.restock_from_return, idempotent - a repeat scan
 * of the same parcel can't double-count), "bad" marks it received and
 * damaged without ever touching inventory.
 */
export default function ReturnsPage() {
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({});
  const [bucket, setBucket] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("order_number");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmCondition, setConfirmCondition] = useState(null); // set to "good" | "bad" to open the dialog
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const filters = {
      search: appliedSearch || undefined,
      search_field: appliedSearch ? searchField : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    };
    try {
      const [data, summaryData] = await Promise.all([
        ordersService.list({
          status: "returned",
          page,
          page_size: pageSize,
          ...bucketParams(bucket),
          ...filters,
        }),
        // Same filters as the table, so the cards describe the slice on screen.
        ordersService.returnsSummary(filters),
      ]);
      setOrders(data.results || []);
      setCount(data.count || 0);
      setSummary(summaryData);
    } catch (err) {
      setError(err.message || "Failed to load returns");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, bucket, appliedSearch, searchField, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  // A selection only makes sense for the rows currently on screen - drop it
  // whenever the underlying list changes out from under it.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [orders]);

  function applyBucket(value) {
    setBucket(value);
    setPage(1);
  }

  const pendingRows = orders.filter((o) => !o.return_received_at);
  const selectedRows = orders.filter((o) => selectedIds.has(o.id));
  const allPendingSelected =
    pendingRows.length > 0 && pendingRows.every((o) => selectedIds.has(o.id));

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allPendingSelected ? new Set() : new Set(pendingRows.map((o) => o.id)));
  }

  async function receiveOne(orderNumber, condition) {
    setRowBusyId(orderNumber);
    setError("");
    setNotice("");
    try {
      const result = await wmsService.scanReturn({ orderNumber, condition });
      if (result.success) {
        setNotice(`${orderNumber} — ${describeOutcome(result)}`);
        await load();
      } else {
        setError(`${orderNumber} — ${result.reason}`);
      }
    } catch (err) {
      setError(err.message || "Receive failed");
    } finally {
      setRowBusyId(null);
    }
  }

  async function runBulkReceive() {
    const condition = confirmCondition;
    setBulkBusy(true);
    setError("");
    setNotice("");
    try {
      const { results = [] } = await wmsService.bulkReceiveReturns({
        orderNumbers: selectedRows.map((o) => o.order_number),
        condition,
      });
      const done = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      setNotice(
        `${condition === "bad" ? "Marked damaged" : "Received"} ${done.length} of ${results.length}.` +
          (failed.length
            ? ` Skipped: ${failed.map((f) => `${f.order_number} (${f.reason})`).join(", ")}`
            : "")
      );
      setConfirmCondition(null);
      await load();
    } catch (err) {
      setError(err.message || "Bulk receive failed");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Returns</h1>
          <p className="mt-1 text-sm text-slate-500">
            Orders the courier reported as returned. Scan a parcel when it physically arrives, then
            say whether it came back good (restocked) or damaged (not restocked).
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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Total Returns"
          value={summary.total_returns ?? 0}
          active={bucket === ""}
          onClick={() => applyBucket("")}
        />
        <SummaryCard
          label="Awaiting Scan"
          value={summary.awaiting_scan ?? 0}
          tone="warning"
          hint="Courier returned, not yet scanned"
          active={bucket === "awaiting"}
          onClick={() => applyBucket("awaiting")}
        />
        <SummaryCard
          label="Received"
          value={summary.received ?? 0}
          tone="success"
          hint="Scanned in good, stock restored"
          active={bucket === "received"}
          onClick={() => applyBucket("received")}
        />
        <SummaryCard
          label="Damaged"
          value={summary.damaged ?? 0}
          tone="danger"
          hint="Scanned in bad, not restocked"
          active={bucket === "damaged"}
          onClick={() => applyBucket("damaged")}
        />
      </div>

      {summary.awaiting_scan > 0 && bucket !== "awaiting" ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <span className="text-sm text-amber-800">
            <strong>{summary.awaiting_scan}</strong>{" "}
            {summary.awaiting_scan === 1 ? "parcel was" : "parcels were"} returned by the courier
            but never scanned in.
          </span>
          <button
            type="button"
            onClick={() => applyBucket("awaiting")}
            className="ml-auto shrink-0 text-sm font-medium text-amber-800 underline"
          >
            View
          </button>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <ScanPanel
          title="Scan returned parcel"
          hint="Scanning only confirms the parcel - nothing is recorded until you pick its condition."
          actionLabel="Check"
          fieldLabel="Tracking number"
          onScan={(trackingNumber) => wmsService.lookupReturn({ trackingNumber })}
          decision={{
            prompt: "Parcel condition?",
            options: CONDITION_OPTIONS,
            // The lookup phase already resolved the tracking number to a
            // real order - ScanPanel hands back that order's order_number
            // here, not the raw tracking number, so this confirms against
            // the exact order that was found.
            onDecide: (orderNumber, condition) => wmsService.scanReturn({ orderNumber, condition }),
          }}
          renderSuccess={describeOutcome}
          onAfterSuccess={load}
        />

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
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
                placeholder="Search returns"
                className="w-56 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
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

          {selectedRows.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
              <span className="text-sm font-medium text-brand-900">
                {selectedRows.length} selected
              </span>
              <Button onClick={() => setConfirmCondition("good")} disabled={bulkBusy}>
                Mark Good
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmCondition("bad")}
                disabled={bulkBusy}
                className="border-red-200 text-red-700 hover:bg-red-50"
              >
                Mark Damaged
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
                  <th className="px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allPendingSelected}
                      onChange={toggleAll}
                      disabled={pendingRows.length === 0}
                      aria-label="Select all awaiting scan"
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Order</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Courier</th>
                  <th className="px-3 py-2 text-left">Returned</th>
                  <th className="px-3 py-2 text-left">Received</th>
                  <th className="px-3 py-2 text-left">Scanned By</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                      {bucket === "awaiting"
                        ? "Nothing awaiting scan."
                        : bucket === "received"
                          ? "No returns received yet."
                          : bucket === "damaged"
                            ? "No damaged returns."
                            : "No returned orders."}
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b border-surface-border last:border-0">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order.id)}
                          onChange={() => toggleRow(order.id)}
                          disabled={Boolean(order.return_received_at)}
                          aria-label={`Select ${order.order_number}`}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{order.order_number}</td>
                      <td className="px-3 py-2 text-slate-600">{order.customer_name}</td>
                      <td className="px-3 py-2 text-slate-600">{order.courier_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(order.returned_at)}</td>
                      <td className="px-3 py-2">
                        {order.return_received_at ? (
                          <span className="text-slate-500">
                            {formatDate(order.return_received_at)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            Awaiting scan
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {order.return_received_by_email || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {order.total_amount}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {order.return_received_at ? (
                          order.return_condition === "bad" ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                              Damaged
                            </span>
                          ) : (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                              Received
                            </span>
                          )
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              disabled={rowBusyId === order.order_number}
                              onClick={() => receiveOne(order.order_number, "good")}
                              className="text-xs font-medium text-green-700 hover:underline disabled:opacity-50"
                            >
                              Good
                            </button>
                            <button
                              type="button"
                              disabled={rowBusyId === order.order_number}
                              onClick={() => receiveOne(order.order_number, "bad")}
                              className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                            >
                              Bad
                            </button>
                          </div>
                        )}
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
        </div>
      </div>

      {confirmCondition ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">
              {confirmCondition === "bad" ? "Mark" : "Receive"} {selectedRows.length}{" "}
              {selectedRows.length === 1 ? "parcel" : "parcels"} as {confirmCondition === "bad" ? "damaged" : "good"}?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {confirmCondition === "bad"
                ? "These are marked received but their stock is not restored."
                : "This puts their units back into stock and marks them received."}{" "}
              Already-received parcels are skipped rather than counted twice.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmCondition(null)} disabled={bulkBusy}>
                Cancel
              </Button>
              <Button onClick={runBulkReceive} loading={bulkBusy}>
                {confirmCondition === "bad" ? "Mark Damaged" : "Mark Good"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
