"use client";

import { useState } from "react";
import { formatWhen, Who } from "./logFormat";

const control =
  "rounded-lg border border-surface-border bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-500";
const th = "whitespace-nowrap px-4 py-3 font-medium";
const td = "px-4 py-3";

function Table({ head, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>{head}</tr>
          </thead>
          <tbody className="divide-y divide-surface-border">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-500">
        {children}
      </td>
    </tr>
  );
}

function OrderCells({ order, showStore }) {
  const created = formatWhen(order.created_at);
  return (
    <>
      {showStore ? <td className={`${td} whitespace-nowrap text-slate-700`}>{order.organization_name}</td> : null}
      <td className={`${td} whitespace-nowrap font-medium text-slate-900`}>{order.order_number}</td>
      <td className={`${td} whitespace-nowrap text-slate-700`}>{order.oms_order_id ?? "-"}</td>
      <td className={`${td} whitespace-nowrap text-slate-700`}>{order.tracking_number || "-"}</td>
      <td className={`${td} whitespace-nowrap text-slate-700`}>{order.status}</td>
      <td className={`${td} whitespace-nowrap text-slate-700`}>
        {created.date} <span className="text-xs text-slate-500">{created.time}</span>
      </td>
    </>
  );
}

function orderHead(showStore) {
  return (
    <>
      {showStore ? <th className={th}>Store</th> : null}
      <th className={th}>Store Order ID</th>
      <th className={th}>OMS Order ID</th>
      <th className={th}>Tracking Number</th>
      <th className={th}>Status</th>
      <th className={th}>Created</th>
    </>
  );
}

// The Logs page's Order Logs tab: find one order by its store order ID,
// OMS order ID or tracking number and list everything that happened to it,
// oldest first. fetchOrderLogs(params) -> {orders, order, logs}.
export default function OrderLogs({ fetchOrderLogs, showStore = false }) {
  const [search, setSearch] = useState("");
  const [searched, setSearched] = useState(false);
  const [matches, setMatches] = useState([]);
  const [order, setOrder] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(params) {
    setLoading(true);
    setError("");
    try {
      const data = await fetchOrderLogs(params);
      if (params.q !== undefined) setMatches(data.orders || []);
      setOrder(data.order || null);
      setLogs(data.logs || []);
    } catch (err) {
      setError(err.message || "Failed to load logs");
      setOrder(null);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    setSearched(true);
    load({ q });
  }

  const orderCols = showStore ? 6 : 5;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">
          Order
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Store order ID, OMS order ID or tracking number"
            className={`${control} mt-1 block w-96 max-w-full`}
          />
        </label>
        <button
          type="submit"
          disabled={loading || !search.trim()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      {matches.length > 1 ? (
        <Table head={orderHead(showStore)}>
          {matches.map((m) => (
            <tr
              key={m.id}
              onClick={() => load({ order_id: m.id })}
              className={`cursor-pointer hover:bg-surface ${order?.id === m.id ? "bg-brand-50" : ""}`}
            >
              <OrderCells order={m} showStore={showStore} />
            </tr>
          ))}
        </Table>
      ) : null}

      {order && matches.length <= 1 ? (
        <Table head={orderHead(showStore)}>
          <tr>
            <OrderCells order={order} showStore={showStore} />
          </tr>
        </Table>
      ) : null}

      {searched && !loading && !error && matches.length === 0 ? (
        <Table head={orderHead(showStore)}>
          <EmptyRow colSpan={orderCols}>No order found.</EmptyRow>
        </Table>
      ) : null}

      {order || (loading && !matches.length) ? (
        <Table
          head={
            <>
              <th className={th}>When</th>
              <th className={th}>Who</th>
              <th className={th}>Action</th>
              <th className={th}>Details</th>
            </>
          }
        >
          {loading ? (
            <EmptyRow colSpan={4}>Loading…</EmptyRow>
          ) : logs.length === 0 ? (
            <EmptyRow colSpan={4}>No logs for this order.</EmptyRow>
          ) : (
            logs.map((log) => {
              const when = formatWhen(log.created_at);
              return (
                <tr key={log.id} className="align-top">
                  <td className={`${td} whitespace-nowrap`}>
                    <div className="text-slate-800">{when.date}</div>
                    <div className="text-xs text-slate-500">{when.time}</div>
                  </td>
                  <td className={td}>
                    <Who log={log} />
                  </td>
                  <td className={`${td} whitespace-nowrap font-medium text-slate-900`}>
                    {log.action}
                    {log.failed ? (
                      <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                        Failed
                      </span>
                    ) : null}
                  </td>
                  <td className={`${td} text-slate-700`}>{log.details || "-"}</td>
                </tr>
              );
            })
          )}
        </Table>
      ) : null}
    </div>
  );
}
