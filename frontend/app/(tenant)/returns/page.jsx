"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ordersService from "../../../services/ordersService";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import { useSessionDateRange } from "../../../store/dateFilterStore";
import ScanPanel from "../../../components/wms/ScanPanel";
import { SCAN_DESKS } from "../../../lib/scanDesks";
import ReturnBreakdownModal from "../../../components/wms/ReturnBreakdownModal";
import Modal from "../../../components/shared/Modal";

// The order's details, read only - opened by clicking its number.
const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});

// Every return is in exactly one of three buckets - "" (Total) is all of
// them: Awaiting Scan (the courier says returned, not scanned in yet),
// Received (scanned in), Not Received (Return in Transit - the courier is
// still bringing it back). Drives both the summary cards and the table
// filter, so a card click and its badge always agree.

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

// "3 good · 1 damaged · 1 lost" - a received parcel's count.
function breakdownText(breakdown) {
  if (!breakdown?.length) return "";
  const t = breakdown.reduce(
    (acc, l) => ({ good: acc.good + l.good, damaged: acc.damaged + l.damaged, lost: acc.lost + l.lost }),
    { good: 0, damaged: 0, lost: 0 }
  );
  return [
    `${t.good} good`,
    t.damaged ? `${t.damaged} damaged` : "",
    t.lost ? `${t.lost} lost` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// The Received badge: just what the parcel came back as - Good, or Damaged
// / Lost - no unit counts.
function conditionText(breakdown, condition) {
  if (!breakdown?.length) return condition === "bad" ? "Damaged" : "Good";
  const any = (key) => breakdown.some((l) => l[key] > 0);
  return [any("good") ? "Good" : "", any("damaged") ? "Damaged" : "", any("lost") ? "Lost" : ""]
    .filter(Boolean)
    .join(" / ");
}

function describeOutcome(entry) {
  const restocked = entry.restocked || [];
  const missed = entry.not_restocked || [];
  const parts = restocked.map((r) => `${r.sku || r.product_name} +${r.quantity}`);
  // Lines with no stock item to put back on (no SKU, no unique name match).
  if (missed.length) parts.push(`not in inventory: ${missed.join(", ")}`);
  const counted = breakdownText(entry.breakdown);
  const stock = parts.length ? `restocked ${parts.join("; ")}` : "nothing restocked";
  return `Received${counted ? ` (${counted})` : ""} — ${stock}`;
}

function bucketParams(bucket) {
  if (bucket === "not_received") return { status: "card:return_in_transit", received: undefined };
  if (bucket === "awaiting") return { status: "returned", received: "no" };
  if (bucket === "received") return { status: "returned", received: "yes" };
  // Total: returned, or still on the way back.
  return { status: "card:all_returns", received: undefined };
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
      title={hint || undefined}
      className={`flex items-center justify-between gap-2 rounded-md border bg-white px-3 py-1.5 text-left transition ${
        active ? "border-brand-800 ring-1 ring-brand-800" : "border-surface-border hover:bg-surface"
      }`}
    >
      <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</span>
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
  const [appliedSearch, setAppliedSearch] = useState("");
  // Shared across screens for the session (store/dateFilterStore).
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useSessionDateRange();

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmCondition, setConfirmCondition] = useState(null); // set to "good" | "bad" to open the dialog
  // The condition ("good"/"bad") of the bulk receive in flight, or null.
  const [bulkBusy, setBulkBusy] = useState(null);
  const [rowBusyId, setRowBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  // The parcel being counted in the receive popup: { orderNumber, lines }.
  const [receiving, setReceiving] = useState(null);
  // The Scan popup (Awaiting Scan's Scan button).
  const [scanOpen, setScanOpen] = useState(false);
  // The order whose details are open (read only), or null.
  const [detailOrderId, setDetailOrderId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const filters = {
      search: appliedSearch || undefined,
      // One box, every field: order, customer, phone, tracking ID, city,
      // product, SKU (backend: OrderViewSet._apply_filters, "all").
      search_field: appliedSearch ? "all" : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    };
    try {
      const [data, summaryData] = await Promise.all([
        ordersService.list({
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
  }, [page, pageSize, bucket, appliedSearch, dateFrom, dateTo]);

  // Searches as you type, once typing pauses.
  useEffect(() => {
    const term = search.trim();
    if (term === appliedSearch) return undefined;
    const timer = setTimeout(() => {
      setAppliedSearch(term);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

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

  const isInProgress = bucket === "not_received";
  // Nothing here has reached status="returned" yet, so there's nothing to
  // scan/receive - the bulk select/receive UI only applies to the other
  // buckets, which are all real "returned" rows.
  // Only parcels the courier has returned can be received - Total also
  // lists ones still on the way back.
  const pendingRows = isInProgress ? [] : orders.filter((o) => o.status === "returned" && !o.return_received_at);
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

  // A row's Receive: looks the parcel up, then opens the count popup.
  async function openReceive(orderNumber) {
    setRowBusyId(orderNumber);
    setError("");
    setNotice("");
    try {
      const result = await wmsService.lookupReturn({ orderNumber });
      if (result.success) setReceiving({ orderNumber: result.order_number, lines: result.lines || [] });
      else setError(`${orderNumber} — ${result.reason}`);
    } catch (err) {
      setError(err.message || "Lookup failed");
    } finally {
      setRowBusyId(null);
    }
  }

  // The popup's Confirm: records the count, restocks the good units.
  async function confirmReceive(breakdown) {
    const { orderNumber } = receiving;
    setError("");
    setNotice("");
    try {
      const result = await wmsService.scanReturn({ orderNumber, breakdown });
      if (result.success) {
        setReceiving(null);
        setNotice(`${orderNumber} — ${describeOutcome(result)}`);
        await load();
      } else {
        setError(`${orderNumber} — ${result.reason}`);
      }
    } catch (err) {
      setError(err.message || "Receive failed");
    }
  }

  async function runBulkReceive() {
    // Close the confirm popup right away - the Mark buttons' spinner shows
    // progress, and nothing else on the page is blocked meanwhile.
    const condition = confirmCondition;
    setConfirmCondition(null);
    setBulkBusy(condition);
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
      await load();
    } catch (err) {
      setError(err.message || "Bulk receive failed");
    } finally {
      setBulkBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900" title={"Scan a returned parcel when it arrives, then count each SKU as good, damaged or lost/missing. Only good units go back into stock."}>Returns</h1>
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

      {/* One grid so phones can reorder it: Scan first (what the desk does
          all day), then the report cards, then the orders list. From lg the
          cards span the top and Scan sits beside the list, as before. */}
      <div className="mt-3 space-y-3">
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              value={summary.received_all ?? 0}
              tone="success"
              hint="Scanned in and counted"
              active={bucket === "received"}
              onClick={() => applyBucket("received")}
            />
            <SummaryCard
              label="Not Received"
              value={summary.not_received ?? 0}
              tone="danger"
              hint="Return in transit, not back yet"
              active={bucket === "not_received"}
              onClick={() => applyBucket("not_received")}
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
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(search.trim());
                setPage(1);
              }}
              className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap"
            >
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order, customer, phone, tracking ID, product…"
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-80"
              />
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
            {/* Awaiting Scan: Scan on the right, opening the scan box in a popup. */}
            {bucket === "awaiting" ? (
              <Button onClick={() => setScanOpen(true)} className="ml-auto">
                Scan
              </Button>
            ) : null}
          </div>

          {selectedRows.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
              <span className="text-sm font-medium text-brand-900">
                {selectedRows.length} selected
              </span>
              <Button
                onClick={() => setConfirmCondition("good")}
                disabled={Boolean(bulkBusy)}
                loading={bulkBusy === "good"}
              >
                Mark Good
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmCondition("bad")}
                disabled={Boolean(bulkBusy)}
                loading={bulkBusy === "bad"}
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
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">
                    {!isInProgress ? (
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        onChange={toggleAll}
                        disabled={pendingRows.length === 0}
                        aria-label="Select all awaiting scan"
                      />
                    ) : null}
                  </th>
                  <th className="px-3 py-2 text-left">Order</th>
                  <th className="px-3 py-2 text-left">Tracking ID</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Courier</th>
                  <th className="px-3 py-2 text-left">{isInProgress ? "In Progress Since" : "Returned"}</th>
                  <th className="px-3 py-2 text-left">Received</th>
                  <th className="px-3 py-2 text-left">Scanned By</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2" />
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
                      {bucket === "not_received"
                        ? "No returns in transit."
                        : bucket === "awaiting"
                          ? "Nothing awaiting scan."
                          : bucket === "received"
                            ? "No returns received yet."
                            : "No returned orders."}
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b border-surface-border last:border-0">
                      <td className="px-3 py-2">
                        {!isInProgress ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(order.id)}
                            onChange={() => toggleRow(order.id)}
                            disabled={Boolean(order.return_received_at) || order.status !== "returned"}
                            aria-label={`Select ${order.order_number}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setDetailOrderId(order.id)}
                          title={`Open order ${order.order_number}`}
                          className="font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          {order.order_number}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{order.tracking_number || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{order.customer_name}</td>
                      <td className="px-3 py-2 text-slate-600">{order.courier_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDate(order.status === "returned" ? order.returned_at : order.return_in_progress_at)}
                      </td>
                      <td className="px-3 py-2">
                        {order.status !== "returned" ? (
                          <span className="text-slate-400">—</span>
                        ) : order.return_received_at ? (
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
                        {order.status !== "returned" ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            Not received
                          </span>
                        ) : order.return_received_at ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              order.return_condition === "bad"
                                ? "bg-red-100 text-red-700"
                                : "bg-green-100 text-green-700"
                            }`}
                          >
                            {conditionText(order.return_breakdown, order.return_condition)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={rowBusyId === order.order_number}
                            onClick={() => openReceive(order.order_number)}
                            className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                          >
                            Receive
                          </button>
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

      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title="Scan" width="max-w-md">
        <ScanPanel
          {...SCAN_DESKS.returns}
          onScan={async (trackingNumber) => {
            // A phone keeps scanning while the laptop's count popup is open -
            // the next parcel must not replace the one being counted.
            if (receiving) {
              return {
                success: false,
                order_number: trackingNumber,
                reason: `Finish counting ${receiving.orderNumber} first`,
              };
            }
            const result = await wmsService.lookupReturn({ trackingNumber });
            // Found and receivable: count it in the popup. The lookup
            // resolved the tracking number to the real order, so the
            // receive goes against that exact order_number.
            if (result.success) {
              setReceiving({ orderNumber: result.order_number, lines: result.lines || [] });
            }
            return result;
          }}
        />
      </Modal>

      {detailOrderId ? (
        <OrderDetailPanel
          orderId={detailOrderId}
          couriers={[]}
          readOnly
          onClose={() => setDetailOrderId(null)}
        />
      ) : null}

      {/* After the Scan popup, so the count popup opens on top of it. */}
      <ReturnBreakdownModal request={receiving} onConfirm={confirmReceive} onClose={() => setReceiving(null)} />

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
              <Button variant="secondary" onClick={() => setConfirmCondition(null)}>
                Cancel
              </Button>
              <Button onClick={runBulkReceive}>
                {confirmCondition === "bad" ? "Mark Damaged" : "Mark Good"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
