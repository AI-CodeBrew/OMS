"use client";

import usePageAccess from "../../../lib/usePageAccess";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ordersService from "../../../services/ordersService";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import { useSessionDateRange } from "../../../store/dateFilterStore";
import ScanPanel from "../../../components/wms/ScanPanel";
import { describeReturnOutcome, SCAN_DESKS } from "../../../lib/scanDesks";
import { usePhoneScanStore } from "../../../lib/phoneScanSession";
import ReturnBreakdownModal from "../../../components/wms/ReturnBreakdownModal";
import ReturnsImportModal from "../../../components/wms/ReturnsImportModal";
import Modal from "../../../components/shared/Modal";
import TrackingLink from "../../../components/shared/TrackingLink";

import { formatDateTime } from "../../../lib/formatDate";
// The order's details, read only - opened by clicking its number.
const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});

// Every returned order is in one of two buckets - "" (Total) is both:
// Awaiting Scan (the courier says returned, not scanned in yet) and
// Received (scanned in). Drives both the summary cards and the table
// filter, so a card click and its badge always agree.

function formatDate(value) {
  return value ? formatDateTime(value) : "—";
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

function bucketParams(bucket) {
  if (bucket === "awaiting") return { status: "returned", received: "no" };
  if (bucket === "received") return { status: "returned", received: "yes" };
  // Total: every returned order, scanned or not.
  return { status: "returned", received: undefined };
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
  const { canWrite } = usePageAccess("wms.returns_desk");
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

  const [rowBusyId, setRowBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  // The parcel being counted in the receive popup: { orderNumber, lines }.
  const [receiving, setReceiving] = useState(null);
  // The Scan popup (Awaiting Scan's Scan button).
  const [scanOpen, setScanOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // The page's own filters - for Export and the Import sheet.
  const pageFilters = {
    search: appliedSearch || undefined,
    search_field: appliedSearch ? "all" : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  };

  async function exportList() {
    setExporting(true);
    setError("");
    try {
      // The card on screen: Awaiting Scan / Received / everything.
      const received = bucket === "awaiting" ? "no" : bucket === "received" ? "yes" : undefined;
      await wmsService.exportReturns({ ...pageFilters, received });
    } catch (err) {
      setError(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }
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

  // A parcel counted on the paired phone, whether or not Scan is open here.
  useEffect(
    () =>
      usePhoneScanStore.subscribe((next, previous) => {
        if (next.returnRecordedAt && next.returnRecordedAt !== previous.returnRecordedAt) load();
      }),
    [load]
  );

  function applyBucket(value) {
    setBucket(value);
    setPage(1);
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
        setNotice(`${orderNumber} — ${describeReturnOutcome(result)}`);
        await load();
      } else {
        setError(`${orderNumber} — ${result.reason}`);
      }
    } catch (err) {
      setError(err.message || "Receive failed");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900" title={"Scan a returned parcel when it arrives, then count each SKU as good, damaged or lost/missing. Only good units go back into stock."}>Returns</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" loading={exporting} onClick={exportList}>
          Export
        </Button>
        {canWrite ? (
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import
          </Button>
        ) : null}
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
          <div className="grid grid-cols-3 gap-2">
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
          </div>

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
            {bucket === "awaiting" && canWrite ? (
              <Button onClick={() => setScanOpen(true)} className="ml-auto">
                Scan
              </Button>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Order</th>
                  <th className="px-3 py-2 text-left">Tracking ID</th>
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
                            : "No returned orders."}
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b border-surface-border last:border-0">
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
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">
                        <TrackingLink courier={order.courier_name} tracking={order.tracking_number} />
                      </td>
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
                        ) : !canWrite ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            Awaiting Scan
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
            // This device's camera keeps reading while the count popup is open -
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

      <ReturnsImportModal
        open={importOpen}
        filters={pageFilters}
        onClose={() => setImportOpen(false)}
        onImported={() => load()}
      />
    </div>
  );
}
