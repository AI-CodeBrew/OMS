"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ordersService from "../../../services/ordersService";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

/**
 * Returns desk. Orders land here when the courier reports them returned
 * (status = "returned"). The physical parcel arrives later, and scanning it
 * here is what actually puts the units back into stock - see
 * wms.services.restock_from_return, which is idempotent so a double scan
 * can't double-count.
 */
export default function ReturnsPage() {
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [scanValue, setScanValue] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanLog, setScanLog] = useState([]);
  const [restockedNumbers, setRestockedNumbers] = useState(new Set());
  const scanInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await ordersService.list({
        status: "returned",
        page,
        page_size: pageSize,
      });
      setOrders(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load returns");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  async function onScan(e) {
    e?.preventDefault();
    const orderNumber = scanValue.trim();
    if (!orderNumber) return;

    setScanning(true);
    try {
      const result = await wmsService.scanReturn({ orderNumber });
      setScanLog((log) => [{ ...result, at: new Date() }, ...log].slice(0, 12));
      if (result.success) {
        setRestockedNumbers((prev) => new Set(prev).add(result.order_number));
        await load();
      }
    } catch (err) {
      setScanLog((log) =>
        [{ success: false, order_number: orderNumber, reason: err.message, at: new Date() }, ...log].slice(0, 12)
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

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <div className="rounded-lg border border-surface-border bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Scan returned parcel</h2>
          <p className="mt-1 text-xs text-slate-500">
            Scan the barcode or type the order number, then press Enter.
          </p>

          <form onSubmit={onScan} className="mt-3 flex gap-2">
            <input
              ref={scanInputRef}
              autoFocus
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              placeholder="Order number"
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <Button type="submit" disabled={scanning || !scanValue.trim()}>
              {scanning ? "…" : "Restock"}
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
                      restocked{" "}
                      {(entry.restocked || [])
                        .map((r) => `${r.sku} +${r.quantity}`)
                        .join(", ")}
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
          <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Order</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Returned At</th>
                  <th className="px-3 py-2 text-left">Reason</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Stock</th>
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No returned orders.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b border-surface-border last:border-0">
                      <td className="px-3 py-2 font-medium text-slate-800">{order.order_number}</td>
                      <td className="px-3 py-2 text-slate-600">{order.customer_name}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDate(order.returned_at)}</td>
                      <td className="px-3 py-2 text-slate-600">{order.return_reason || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {order.total_amount}
                      </td>
                      <td className="px-3 py-2">
                        {restockedNumbers.has(order.order_number) ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                            Restocked
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setScanValue(order.order_number);
                              scanInputRef.current?.focus();
                            }}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            Restock
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
