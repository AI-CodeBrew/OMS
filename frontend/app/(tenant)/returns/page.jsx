"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ordersService from "../../../services/ordersService";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";

const TABS = [
  { value: "", label: "All Returns" },
  { value: "no", label: "Awaiting Scan" },
  { value: "yes", label: "Received" },
];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function SummaryCard({ label, value, tone = "default", hint }) {
  const tones = {
    default: "text-slate-900",
    warning: "text-amber-600",
    success: "text-green-600",
  };
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Returns desk. Orders arrive here when the courier reports them returned
 * (status = "returned"). The parcel physically turns up later, and
 * scanning it here is what puts stock back and marks it received - see
 * wms.services.restock_from_return, which is idempotent so a double scan
 * cannot double-count.
 */
export default function ReturnsPage() {
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({});
  const [receivedFilter, setReceivedFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [scanValue, setScanValue] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanLog, setScanLog] = useState([]);
  const scanInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, summaryData] = await Promise.all([
        ordersService.list({
          status: "returned",
          received: receivedFilter || undefined,
          page,
          page_size: pageSize,
        }),
        ordersService.returnsSummary(),
      ]);
      setOrders(data.results || []);
      setCount(data.count || 0);
      setSummary(summaryData);
    } catch (err) {
      setError(err.message || "Failed to load returns");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, receivedFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function restock(orderNumber) {
    if (!orderNumber) return;
    setScanning(true);
    try {
      const result = await wmsService.scanReturn({ orderNumber });
      setScanLog((log) => [{ ...result, at: new Date() }, ...log].slice(0, 12));
      if (result.success) await load();
    } catch (err) {
      setScanLog((log) =>
        [
          { success: false, order_number: orderNumber, reason: err.message, at: new Date() },
          ...log,
        ].slice(0, 12)
      );
    } finally {
      setScanning(false);
      setScanValue("");
      // Keep focus so a barcode scanner can fire straight into the next one.
      scanInputRef.current?.focus();
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Returns</h1>
        <p className="mt-1 text-sm text-slate-500">
          Orders the courier reported as returned. Scan a parcel when it physically arrives to put
          its stock back.
        </p>
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Total Returns" value={summary.total_returns ?? 0} />
        <SummaryCard
          label="Awaiting Scan"
          value={summary.awaiting_scan ?? 0}
          tone="warning"
          hint="Courier returned, not yet received"
        />
        <SummaryCard
          label="Received"
          value={summary.received ?? 0}
          tone="success"
          hint="Scanned in, stock restored"
        />
      </div>

      {summary.awaiting_scan > 0 ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <span className="text-sm text-amber-800">
            <strong>{summary.awaiting_scan}</strong>{" "}
            {summary.awaiting_scan === 1 ? "parcel was" : "parcels were"} returned by the courier
            but never scanned in — their stock has not been added back.
          </span>
          <button
            type="button"
            onClick={() => {
              setReceivedFilter("no");
              setPage(1);
            }}
            className="ml-auto shrink-0 text-sm font-medium text-amber-800 underline"
          >
            View
          </button>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <div className="h-fit rounded-lg border border-surface-border bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Scan returned parcel</h2>
          <p className="mt-1 text-xs text-slate-500">
            Scan the barcode or type the order number, then press Enter.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              restock(scanValue.trim());
            }}
            className="mt-3 flex gap-2"
          >
            <input
              ref={scanInputRef}
              autoFocus
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              placeholder="Order number"
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <Button type="submit" disabled={scanning || !scanValue.trim()}>
              {scanning ? "…" : "Receive"}
            </Button>
          </form>

          {scanLog.length > 0 ? (
            <div className="mt-4 space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Recent scans
              </p>
              {scanLog.map((entry, i) => (
                <div
                  key={i}
                  className={`rounded-md px-2.5 py-1.5 text-xs ${
                    entry.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
                  }`}
                >
                  <span className="font-medium">{entry.order_number}</span>{" "}
                  {entry.success ? (
                    <>
                      received —{" "}
                      {(entry.restocked || []).length > 0
                        ? (entry.restocked || [])
                            .map((r) => `${r.sku} +${r.quantity}`)
                            .join(", ")
                        : "no tracked SKUs"}
                    </>
                  ) : (
                    <>— {entry.reason}</>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <div className="mb-3 flex gap-1.5">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => {
                  setReceivedFilter(tab.value);
                  setPage(1);
                }}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                  receivedFilter === tab.value
                    ? "border-brand-800 bg-brand-800 text-white"
                    : "border-surface-border bg-white text-slate-600 hover:bg-surface"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Order</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Courier</th>
                  <th className="px-3 py-2 text-left">Returned</th>
                  <th className="px-3 py-2 text-left">Received</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      {receivedFilter === "no"
                        ? "Nothing awaiting scan."
                        : receivedFilter === "yes"
                          ? "No returns received yet."
                          : "No returned orders."}
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b border-surface-border last:border-0">
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
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {order.total_amount}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {order.return_received_at ? (
                          <span className="text-[11px] font-medium text-green-700">Received</span>
                        ) : (
                          <button
                            type="button"
                            disabled={scanning}
                            onClick={() => restock(order.order_number)}
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
    </div>
  );
}
