"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import Pagination from "../shared/Pagination";
import OrdersTable from "../orders/OrdersTable";
import { STATUS_LABELS } from "../orders/statusConfig";
import ordersService from "../../services/ordersService";

function EyeIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// Whole-number percentages that add up to exactly 100 when the counts make
// up the total (largest remainder) - rounding each on its own could show
// 99% or 101%. Otherwise each is simply rounded.
function wholePercents(counts, total) {
  if (!total) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  if (counts.reduce((a, b) => a + b, 0) !== total) return exact.map(Math.round);
  const result = exact.map(Math.floor);
  let left = 100 - result.reduce((a, b) => a + b, 0);
  exact
    .map((x, i) => [x - Math.floor(x), i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0) {
        result[i] += 1;
        left -= 1;
      }
    });
  return result;
}

/**
 * A Dashboard card's orders split into its OMS types (backend:
 * oms.services.dashboard_types) - the card's tags, cancel reasons, return
 * reasons or couriers - each with its count and share. The eye opens that
 * type's orders (TypeOrdersModal). `range` is the Dashboard's
 * {date_from, date_to}; `group` is {key, label, color}, null when closed.
 */
export function CardBreakdownModal({ group, range, onClose, onOpenType }) {
  const [types, setTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!group) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    ordersService
      .dashboardBreakdown({ group: group.key, ...range })
      .then((data) => {
        if (cancelled) return;
        setTypes(data.types || []);
        setTotal(data.total || 0);
      })
      .catch((err) => !cancelled && setError(err.message || "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [group, range]);

  if (!group) return null;

  const pcts = wholePercents(types.map((t) => t.count), total);

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-xl"
      title={
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: group.color }} />
          {group.label}
        </span>
      }
    >
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-surface" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {types.length === 0 ? <p className="text-sm text-slate-500">No orders in this range.</p> : null}
          {types.map((t, i) => {
            const pct = pcts[i];
            return (
              <div key={t.key}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-800">{t.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{t.count}</span>
                    <button
                      type="button"
                      onClick={() => onOpenType(t)}
                      disabled={!t.count}
                      title="View orders"
                      className="rounded p-1 text-slate-500 hover:bg-surface hover:text-slate-800 disabled:opacity-40"
                    >
                      <EyeIcon className="h-5 w-5" />
                    </button>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{pct}%</p>
              </div>
            );
          })}
          <p className="border-t border-surface-border pt-3 text-sm text-slate-700">Total: {total} orders</p>
        </div>
      )}
    </Modal>
  );
}

/**
 * One type's orders: chips for the OMS statuses they're in (click one to
 * narrow the table to it), the orders table, pages, and a CSV download of
 * the same filter. `type` is {key, label}, null when closed.
 */
export function TypeOrdersModal({ group, type, range, onClose, onOpenDetail, showStoreColumn }) {
  const [status, setStatus] = useState("");
  const [statusCounts, setStatusCounts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const filter = group && type ? { ...range, dash_group: group.key, dash_type: type.key } : null;
  const filterKey = filter ? JSON.stringify(filter) : "";

  useEffect(() => {
    setStatus("");
    setPage(1);
  }, [filterKey]);

  useEffect(() => {
    if (!filterKey) return undefined;
    let cancelled = false;
    ordersService
      .counts(JSON.parse(filterKey))
      .then((counts) => {
        if (cancelled) return;
        setStatusCounts(
          Object.keys(STATUS_LABELS)
            .filter((s) => counts[s] > 0)
            .map((s) => ({ status: s, label: STATUS_LABELS[s], count: counts[s] }))
        );
      })
      .catch(() => !cancelled && setStatusCounts([]));
    return () => {
      cancelled = true;
    };
  }, [filterKey]);

  const load = useCallback(async () => {
    if (!filterKey) return;
    setLoading(true);
    setError("");
    try {
      const data = await ordersService.list({
        ...JSON.parse(filterKey),
        status: status || undefined,
        page,
        page_size: pageSize,
      });
      setOrders(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [filterKey, status, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadCsv() {
    setDownloading(true);
    try {
      const blob = await ordersService.exportCsv({
        ...JSON.parse(filterKey),
        status: status || undefined,
        template: "all",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${group.label}-${type.label}.csv`.replace(/[^\w.-]+/g, "_");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  if (!filter) return null;

  return (
    <Modal open onClose={onClose} width="max-w-6xl" title={`${group.label} - ${type.label}`}>
      <p className="text-xs text-slate-500">Type: {type.label}</p>
      {statusCounts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {statusCounts.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                setStatus("");
                setPage(1);
              }}
              className={`rounded-full px-3 py-1.5 text-sm ${
                !status ? "bg-blue-600 text-white" : "bg-blue-50 text-slate-800 hover:bg-blue-100"
              }`}
            >
              All: {statusCounts.reduce((sum, s) => sum + s.count, 0)}
            </button>
          ) : null}
          {statusCounts.map((s) => (
            <button
              key={s.status}
              type="button"
              onClick={() => {
                setStatus(status === s.status ? "" : s.status);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1.5 text-sm ${
                status === s.status ? "bg-blue-600 text-white" : "bg-blue-50 text-slate-800 hover:bg-blue-100"
              }`}
            >
              {s.label}: {s.count}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4">
        <OrdersTable
          orders={orders}
          loading={loading}
          selectedIds={new Set()}
          onToggleSelect={() => {}}
          onToggleSelectAll={() => {}}
          onOpenDetail={onOpenDetail}
          showStoreColumn={showStoreColumn}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button onClick={downloadCsv} loading={downloading} disabled={!count}>
          Download CSV
        </Button>
        {count > 0 ? (
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
        ) : null}
      </div>
    </Modal>
  );
}
