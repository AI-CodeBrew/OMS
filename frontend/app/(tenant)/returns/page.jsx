"use client";

import useOrderNav from "../../../components/orders/useOrderNav";
import usePageAccess from "../../../lib/usePageAccess";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ordersService from "../../../services/ordersService";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import SearchBox from "../../../components/shared/SearchBox";
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
import ReceivingStatus from "../../../components/orders/ReceivingStatus";
import { latestTag } from "../../../components/orders/statusConfig";

import { formatDateTime } from "../../../lib/formatDate";
import { useRememberedData, useRememberedState } from "../../../lib/pageMemory";
// The order's details, read only - opened by clicking its number.
const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});

// The desk's cards (user, 2026-11-26 - a parcel can reach the warehouse
// before the courier marks it returned, so Return in Transit is scanned
// here too): "" Total = Return in Transit + Returned; "transit" = Return in
// Transit not received yet; "awaiting" = Returned not received yet
// (Awaiting Scan); "received" = scanned in, either way. Drives both the
// summary cards and the table filter, so a card click and its rows agree.

function formatDate(value) {
  return value ? formatDateTime(value) : "—";
}

function bucketParams(bucket) {
  if (bucket === "transit") return { status: "card:return_in_transit", received: "no" };
  if (bucket === "awaiting") return { status: "returned", received: "no" };
  if (bucket === "received") return { status: "card:all_returns", received: "yes" };
  // Total: on the way back or back, scanned or not.
  return { status: "card:all_returns", received: undefined };
}

// Return in Transit or Returned - and whether the desk can still receive it.
function cardName(order) {
  if (order.workflow_card === "return_in_transit") return "Return in Transit";
  return order.status === "returned" ? "Returned" : "";
}

function canReceive(order) {
  return !order.return_received_at && (order.status === "returned" || order.workflow_card === "return_in_transit");
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
 * Returns desk. Orders show here from Return in Transit (the courier is
 * bringing the parcel back) and Returned. The parcel physically turns up,
 * sometimes before the courier marks it returned, and scanning it here -
 * in either card - records what happened to it (its Receiving Status):
 * good units go back into stock (wms.services.restock_from_return,
 * idempotent - a repeat scan can't double-count), damaged / lost ones
 * never touch inventory. The order's tag stays the courier mapping's.
 */
export default function ReturnsPage() {
  const { canWrite } = usePageAccess("wms.returns_desk");
  // Back to this page: the card, page and search as they were left, the
  // last rows at once - refreshed quietly (user, 2026-11-24).
  const { recall, remember } = useRememberedData("returns");
  const [bucket, setBucket] = useRememberedState("bucket", "");
  const [page, setPage] = useRememberedState("page", 1);
  const [pageSize, setPageSize] = useRememberedState("pageSize", 25);
  const [search, setSearch] = useRememberedState("search", "");
  const [appliedSearch, setAppliedSearch] = useRememberedState("appliedSearch", "");
  // Shared across screens for the session (store/dateFilterStore).
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useSessionDateRange();
  const viewKey = [bucket, page, pageSize, appliedSearch, dateFrom, dateTo].join("|");
  const [arrival] = useState(() => recall()?.[viewKey] || null);
  const [orders, setOrders] = useState(() => arrival?.orders || []);
  const [count, setCount] = useState(() => arrival?.count || 0);
  const [summary, setSummary] = useState(() => arrival?.summary || {});
  const [loading, setLoading] = useState(() => !arrival);
  const [error, setError] = useState("");

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
      // The card on screen: Return in Transit / Awaiting Scan / Received / everything.
      await wmsService.exportReturns({ ...pageFilters, bucket: bucket || "all" });
    } catch (err) {
      setError(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }
  // The order whose details are open (read only), or null.
  const [detailOrderId, setDetailOrderId] = useState(null);
  // The details panel's previous / next arrows step through this list.
  const orderNav = useOrderNav(orders, detailOrderId, setDetailOrderId);

  const load = useCallback(async () => {
    const cached = recall()?.[viewKey];
    if (cached) {
      // Seen before: its rows at once, refreshed quietly below.
      setOrders(cached.orders);
      setCount(cached.count);
      setSummary(cached.summary);
    } else {
      setLoading(true);
    }
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
      remember({ ...(recall() || {}), [viewKey]: { orders: data.results || [], count: data.count || 0, summary: summaryData } });
    } catch (err) {
      setError(err.message || "Failed to load returns");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, bucket, appliedSearch, dateFrom, dateTo]);

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
  // By the row's own order id - its number alone can be on another store's
  // order too in the Dispatch Hub / All Orders (#3367, 2026-11-23).
  async function openReceive(orderNumber, orderId) {
    setRowBusyId(orderNumber);
    setError("");
    setNotice("");
    try {
      const result = await wmsService.lookupReturn({ orderNumber, orderId });
      if (result.success)
        setReceiving({ orderNumber: result.order_number, orderId: result.order_id, lines: result.lines || [] });
      else setError(`${orderNumber} — ${result.reason}`);
    } catch (err) {
      setError(err.message || "Lookup failed");
    } finally {
      setRowBusyId(null);
    }
  }

  // The popup's Confirm: records the count, restocks the good units.
  async function confirmReceive(breakdown) {
    const { orderNumber, orderId } = receiving;
    setError("");
    setNotice("");
    try {
      const result = await wmsService.scanReturn({ orderNumber, orderId, breakdown });
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryCard
              label="Total Returns"
              value={summary.desk_total ?? summary.total_returns ?? 0}
              hint="Return in Transit and Returned, scanned or not"
              active={bucket === ""}
              onClick={() => applyBucket("")}
            />
            <SummaryCard
              label="Return in Transit"
              value={summary.desk_in_transit ?? 0}
              tone="warning"
              hint="Courier is bringing it back, not scanned yet - scan it if it has reached the warehouse"
              active={bucket === "transit"}
              onClick={() => applyBucket("transit")}
            />
            <SummaryCard
              label="Awaiting Scan"
              value={summary.desk_awaiting_scan ?? summary.awaiting_scan ?? 0}
              tone="warning"
              hint="Courier returned, not yet scanned"
              active={bucket === "awaiting"}
              onClick={() => applyBucket("awaiting")}
            />
            <SummaryCard
              label="Received"
              value={summary.desk_received ?? summary.received_all ?? 0}
              tone="success"
              hint="Scanned in and counted - in Return in Transit or Returned"
              active={bucket === "received"}
              onClick={() => applyBucket("received")}
            />
          </div>

        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
              <SearchBox
                value={search}
                onChange={setSearch}
                onSearch={(term) => {
                  setAppliedSearch(term);
                  setPage(1);
                }}
                suggestions={orders.flatMap((o) => [o.order_number, o.customer_name, o.tracking_number])}
                getSuggestions={ordersService.suggestProductNames.bind(ordersService)}
                button={false}
                placeholder="Search order, customer, phone, tracking ID, product…"
                className="w-full sm:w-auto"
                inputClassName="w-full sm:w-80"
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
            </div>
            {/* Scan on the right, opening the scan box in a popup - any card:
                Return in Transit parcels are scanned too. */}
            {canWrite ? (
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
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Tag</th>
                  <th className="px-3 py-2 text-left">Returned</th>
                  <th className="px-3 py-2 text-left">Receiving Status</th>
                  <th className="px-3 py-2 text-left">Scanned By</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                      {bucket === "awaiting"
                          ? "Nothing awaiting scan."
                          : bucket === "transit"
                            ? "Nothing in Return in Transit waiting to be scanned."
                            : bucket === "received"
                              ? "No returns received yet."
                              : "No returns."}
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
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            order.status === "returned" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {cardName(order) || "—"}
                        </span>
                      </td>
                      <td
                        className="max-w-[12rem] truncate px-3 py-2 text-xs text-slate-600"
                        title={latestTag(order)?.text || ""}
                      >
                        {latestTag(order)?.text || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDate(order.status === "returned" ? order.returned_at : order.return_in_progress_at)}
                      </td>
                      <td className="px-3 py-2">
                        <ReceivingStatus order={order} />
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {order.return_received_by_email || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {order.total_amount}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!canReceive(order) || !canWrite ? null : (
                          <button
                            type="button"
                            disabled={rowBusyId === order.order_number}
                            onClick={() => openReceive(order.order_number, order.id)}
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
            // receive goes against that exact order (its id).
            if (result.success) {
              setReceiving({ orderNumber: result.order_number, orderId: result.order_id, lines: result.lines || [] });
            }
            return result;
          }}
        />
      </Modal>

      {detailOrderId ? (
        <OrderDetailPanel
          orderId={detailOrderId}
          onPrev={orderNav.onPrev}
          onNext={orderNav.onNext}
          position={orderNav.position}
          couriers={[]}
          readOnly
          onClose={() => setDetailOrderId(null)}
        />
      ) : null}

      {/* After the Scan popup, so the count popup opens on top of it. */}
      <ReturnBreakdownModal request={receiving} onConfirm={confirmReceive} onClose={() => setReceiving(null)} />

      <ReturnsImportModal
        open={importOpen}
        filters={{ ...pageFilters, bucket }}
        onClose={() => setImportOpen(false)}
        onImported={() => load()}
      />
    </div>
  );
}
