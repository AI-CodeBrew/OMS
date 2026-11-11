"use client";

import { useCallback, useEffect, useState } from "react";
import { formatWhen, isFailed, Who } from "./logFormat";

// The super admin's Logs page. Opens on the last few order updates (no
// order list is loaded). Searching an order - store order ID, OMS order ID
// or tracking number - shows its whole log as a table, oldest first, the
// last row being where the order is now.
//   fetchLogs(params)      -> {results}        (activity log rows)
//   fetchOrderLogs(params) -> {orders, order, logs}

const RECENT_COUNT = 10;

const th = "whitespace-nowrap px-3 py-2.5 text-left font-medium";
const td = "px-3 py-2 align-top";

function Table({ head, children }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-surface-border bg-surface text-[11px] uppercase tracking-wide text-slate-500">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-surface-border">{children}</tbody>
      </table>
    </div>
  );
}

function Message({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-slate-500">
        {children}
      </td>
    </tr>
  );
}

function When({ iso }) {
  const when = formatWhen(iso);
  return (
    <>
      <div className="whitespace-nowrap text-slate-800">{when.date}</div>
      <div className="whitespace-nowrap text-xs text-slate-500">{when.time}</div>
    </>
  );
}

function FailedTag() {
  return (
    <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Failed</span>
  );
}

// "Order #1009: Status changed ..." -> "#1009" and "Status changed ...".
function splitSummary(log) {
  const number = log.metadata?.order_number || log.summary?.match(/#[\w-]+/)?.[0] || "";
  const what = (log.summary || "").replace(/^Order [^:]+:\s*/, "") || log.action;
  return { number: String(number).replace(/^#/, ""), what };
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
    </svg>
  );
}

// The last few order updates over every store, newest first. A row with an
// order opens that order's full log.
function RecentUpdates({ fetchLogs, onOpenOrder }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetchLogs({ category: "orders", page_size: RECENT_COUNT })
      .then((data) => setRows(data.results || []))
      .catch((err) => setError(err.message || "Failed to load logs"))
      .finally(() => setLoading(false));
  }, [fetchLogs]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Last {RECENT_COUNT} order updates</h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-surface-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <Table
        head={
          <>
            <th className={th}>When</th>
            <th className={th}>Store</th>
            <th className={th}>Order</th>
            <th className={th}>What happened</th>
            <th className={th}>Who</th>
          </>
        }
      >
        {loading && rows.length === 0 ? (
          <Message colSpan={5}>Loading…</Message>
        ) : rows.length === 0 ? (
          <Message colSpan={5}>No order updates yet.</Message>
        ) : (
          rows.map((log) => {
            const { number, what } = splitSummary(log);
            const canOpen = log.entity_type === "order" && log.entity_id;
            return (
              <tr key={log.id} className="hover:bg-surface">
                <td className={td}>
                  <When iso={log.created_at} />
                </td>
                <td className={`${td} whitespace-nowrap text-slate-700`}>{log.organization_name}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {canOpen ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrder(log.entity_id)}
                      title="Show this order's full log"
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {number || "Open"}
                    </button>
                  ) : (
                    <span className="text-slate-700">{number || "—"}</span>
                  )}
                </td>
                <td className={`${td} text-slate-800`}>
                  {what}
                  {isFailed(log) ? <FailedTag /> : null}
                </td>
                <td className={td}>
                  <Who log={log} />
                </td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}

// One order's whole log, oldest first; the last row is where it is now.
function OrderLog({ order, logs }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-surface-border bg-white px-4 py-3 text-sm">
        <div>
          <span className="text-slate-500">Order </span>
          <span className="font-semibold text-slate-900">{String(order.order_number || "").replace(/^#/, "")}</span>
        </div>
        <div>
          <span className="text-slate-500">OMS ID </span>
          <span className="font-medium text-slate-800">{order.oms_order_id ?? "—"}</span>
        </div>
        <div>
          <span className="text-slate-500">Store </span>
          <span className="font-medium text-slate-800">{order.organization_name}</span>
        </div>
        <div>
          <span className="text-slate-500">Tracking </span>
          <span className="font-medium text-slate-800">{order.tracking_number || "—"}</span>
        </div>
        <div>
          <span className="text-slate-500">Current status </span>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
            {order.status}
          </span>
        </div>
      </div>

      <Table
        head={
          <>
            <th className={`${th} w-12`}>#</th>
            <th className={th}>When</th>
            <th className={th}>Action</th>
            <th className={th}>Details</th>
            <th className={th}>Who</th>
          </>
        }
      >
        {logs.length === 0 ? (
          <Message colSpan={5}>No logs for this order.</Message>
        ) : (
          logs.map((log, i) => {
            const current = i === logs.length - 1;
            return (
              <tr key={log.id} className={current ? "bg-brand-50" : "hover:bg-surface"}>
                <td className={`${td} tabular-nums text-slate-500`}>{i + 1}</td>
                <td className={td}>
                  <When iso={log.created_at} />
                </td>
                <td className={`${td} whitespace-nowrap font-medium text-slate-900`}>
                  {log.action}
                  {log.failed ? <FailedTag /> : null}
                  {current ? (
                    <span className="ml-2 rounded bg-brand-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                      Current
                    </span>
                  ) : null}
                </td>
                <td className={`${td} text-slate-700`}>{log.details || "—"}</td>
                <td className={td}>
                  <Who log={log} />
                </td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}

export default function OrderLogsBrowser({ fetchLogs, fetchOrderLogs }) {
  const [search, setSearch] = useState("");
  // null: nothing searched - the recent updates show.
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(params) {
    setLoading(true);
    setError("");
    try {
      const data = await fetchOrderLogs(params);
      setResult((prev) => ({
        // Picking one of several matches keeps the list to pick from.
        orders: params.q !== undefined ? data.orders || [] : prev?.orders || [],
        order: data.order || null,
        logs: data.logs || [],
      }));
    } catch (err) {
      setError(err.message || "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setSearch("");
    setResult(null);
    setError("");
  }

  const several = (result?.orders.length || 0) > 1;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = search.trim();
          if (q) load({ q });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative w-full max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value.trim()) clear();
            }}
            placeholder="Search order: Store order ID, OMS order ID or tracking number"
            className="w-full rounded-md border border-surface-border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !search.trim()}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
        {result ? (
          <button type="button" onClick={clear} className="text-sm font-medium text-slate-600 hover:underline">
            Back to recent updates
          </button>
        ) : null}
      </form>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {!result ? (
        <RecentUpdates fetchLogs={fetchLogs} onOpenOrder={(id) => load({ order_id: id })} />
      ) : (
        <>
          {several ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-800">
                {result.orders.length} orders match - pick one
              </h2>
              <Table
                head={
                  <>
                    <th className={th}>Store</th>
                    <th className={th}>Order</th>
                    <th className={th}>OMS ID</th>
                    <th className={th}>Tracking</th>
                    <th className={th}>Status</th>
                    <th className={th}>Created</th>
                  </>
                }
              >
                {result.orders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => load({ order_id: o.id })}
                    className={`cursor-pointer hover:bg-surface ${result.order?.id === o.id ? "bg-brand-50" : ""}`}
                  >
                    <td className={`${td} whitespace-nowrap text-slate-700`}>{o.organization_name}</td>
                    <td className={`${td} whitespace-nowrap font-semibold text-brand-700`}>
                      {String(o.order_number || "").replace(/^#/, "")}
                    </td>
                    <td className={`${td} text-slate-700`}>{o.oms_order_id ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap text-slate-700`}>{o.tracking_number || "—"}</td>
                    <td className={`${td} whitespace-nowrap text-slate-700`}>{o.status}</td>
                    <td className={td}>
                      <When iso={o.created_at} />
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : null}

          {loading && !result.order ? <p className="text-sm text-slate-500">Loading…</p> : null}

          {result.order ? (
            <OrderLog order={result.order} logs={result.logs} />
          ) : !loading && !several ? (
            <p className="rounded-lg border border-surface-border bg-white px-4 py-8 text-center text-sm text-slate-500">
              No order found.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
