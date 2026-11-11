"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import authService from "../../services/authService";
import ordersService from "../../services/ordersService";
import dispatchHubAdminService from "../../services/dispatchHubAdminService";
import OrderStatusTabs from "../orders/OrderStatusTabs";
import OrderFieldFilters, { activeFilterCount } from "../orders/OrderFieldFilters";
import DateRangeFilter from "../orders/DateRangeFilter";
import { STATUS_LABELS, cardTab } from "../orders/statusConfig";
import Pagination from "../shared/Pagination";
import { useDateFilterStore } from "../../store/dateFilterStore";
import { formatDateTime } from "../../lib/formatDate";
import { formatWhen, Who } from "./logFormat";

// The super admin's Logs page: every store's orders, with the same status
// cards, search and Filters (one value or many) as All Orders. Opening an
// order shows its whole history right under it, A to Z - what happened,
// when, and who did it. The orders come from the All Orders list, read with
// the "all stores" scope while this is open (authService.setHubScopeOverride);
// fetchOrderLogs({order_id}) -> {order, logs} gives one order's history.

const EMPTY_FILTERS = {
  date_from: "", date_to: "", store: "", product: "",
  f_oms_id: "", f_store_order_id: "", f_customer: "", f_phone: "", f_tracking: "",
  f_shop: "", f_city: "", f_province: "", f_courier: "",
};

const th = "whitespace-nowrap px-3 py-2.5 text-left font-medium";
const td = "px-3 py-2";
const COLS = 9;

function statusOf(order) {
  const card = cardTab(order.workflow_card);
  if (card) return card.label;
  return STATUS_LABELS[order.status] || String(order.status || "-").replace(/_/g, " ");
}

function Chevron({ open }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// One order's history, oldest first - loaded when it is opened.
function OrderHistory({ orderId, fetchOrderLogs }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchOrderLogs({ order_id: orderId })
      .then((data) => !cancelled && setLogs(data.logs || []))
      .catch((err) => !cancelled && setError(err.message || "Failed to load logs"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orderId, fetchOrderLogs]);

  if (loading) return <p className="py-4 text-center text-sm text-slate-500">Loading history…</p>;
  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!logs.length) return <p className="py-4 text-center text-sm text-slate-500">No logs for this order.</p>;

  return (
    <ol className="relative space-y-3 border-l border-surface-border pl-5">
      {logs.map((log, i) => {
        const when = formatWhen(log.created_at);
        return (
          <li key={log.id} className="relative">
            <span
              className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-slate-50 ${
                log.failed ? "bg-red-500" : i === logs.length - 1 ? "bg-brand-500" : "bg-slate-300"
              }`}
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="whitespace-nowrap text-xs text-slate-500">
                {when.date} · {when.time}
              </span>
              <span className="text-sm font-medium text-slate-900">
                {log.action}
                {log.failed ? (
                  <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                    Failed
                  </span>
                ) : null}
              </span>
              <span className="text-xs">
                <span className="text-slate-500">by </span>
                <Who log={log} />
              </span>
            </div>
            {log.details ? <p className="mt-0.5 text-sm text-slate-600">{log.details}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderLogsBrowser({ fetchOrderLogs }) {
  const [activeStatus, setActiveStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const setSessionRange = useDateFilterStore((s) => s.setRange);
  const [appliedFilters, setAppliedFilters] = useState(() => {
    const shared = useDateFilterStore.getState();
    return { ...EMPTY_FILTERS, date_from: shared.dateFrom, date_to: shared.dateTo };
  });
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [counts, setCounts] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stores, setStores] = useState([]);
  const [openIds, setOpenIds] = useState(() => new Set());
  const loadGen = useRef(0);
  // Set during render (not in an effect) so it is already on for the
  // first load below; taken off again when the page closes.
  authService.setHubScopeOverride("all");
  useEffect(() => {
    authService.setHubScopeOverride("all");
    return () => authService.setHubScopeOverride(null);
  }, []);

  useEffect(() => {
    dispatchHubAdminService
      .listStores({ allStores: true })
      .then((list) => setStores(list.map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => setStores([]));
  }, []);

  const queryParams = useMemo(
    () => ({
      status: activeStatus === "all" ? undefined : activeStatus,
      search: appliedSearch || undefined,
      search_field: appliedSearch ? "all" : undefined,
      ...appliedFilters,
    }),
    [activeStatus, appliedSearch, appliedFilters]
  );

  // A new tab, search or filter starts again on page 1.
  useEffect(() => {
    setPage(1);
  }, [queryParams]);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError("");
    try {
      const { status, ...countParams } = queryParams;
      const [list, tabCounts] = await Promise.all([
        ordersService.list({ ...queryParams, page, page_size: pageSize }),
        ordersService.counts(countParams).catch(() => null),
      ]);
      if (gen !== loadGen.current) return;
      setOrders(list.results || []);
      setCount(list.count || 0);
      if (tabCounts) setCounts(tabCounts);
    } catch (err) {
      if (gen !== loadGen.current) return;
      setError(err.message || "Failed to load orders");
      setOrders([]);
      setCount(0);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [queryParams, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const activeFilters = activeFilterCount(appliedFilters, { hub: true });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(search.trim());
          }}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value.trim() && appliedSearch) setAppliedSearch("");
            }}
            placeholder="Search order no., customer, phone, tracking, city…"
            className="w-full min-w-0 rounded-md border border-surface-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-96 sm:flex-none"
          />
          <button
            type="submit"
            className="rounded-md border border-surface-border bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium ${
              activeFilters || filtersOpen
                ? "border-brand-300 bg-brand-50 text-brand-800"
                : "border-surface-border bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
            </svg>
            Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </form>
        <DateRangeFilter
          dateFrom={appliedFilters.date_from}
          dateTo={appliedFilters.date_to}
          onApplyDateRange={(date_from, date_to) => {
            setSessionRange(date_from, date_to);
            setAppliedFilters((f) => ({ ...f, date_from, date_to }));
          }}
          onClearDateRange={() => {
            setSessionRange("", "");
            setAppliedFilters((f) => ({ ...f, date_from: "", date_to: "" }));
          }}
        />
      </div>

      <OrderStatusTabs counts={counts} activeStatus={activeStatus} onChange={setActiveStatus} />

      {filtersOpen ? (
        <OrderFieldFilters
          applied={appliedFilters}
          baseParams={queryParams}
          hub={{ stores, status: activeStatus === "all" ? undefined : activeStatus }}
          onApply={(next) => setAppliedFilters((f) => ({ ...f, ...next }))}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-surface-border bg-surface text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-2 py-2.5" />
              <th className={th}>Store</th>
              <th className={th}>Order ID</th>
              <th className={th}>OMS ID</th>
              <th className={th}>Placed</th>
              <th className={th}>Customer</th>
              <th className={th}>City</th>
              <th className={th}>Courier / Tracking</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-3 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-3 py-8 text-center text-slate-500">
                  No orders found.
                </td>
              </tr>
            ) : (
              orders.map((order) => {
                const open = openIds.has(order.id);
                return (
                  <Fragment key={order.id}>
                    <tr
                      onClick={() => toggle(order.id)}
                      className={`cursor-pointer border-b border-surface-border hover:bg-surface ${
                        open ? "bg-brand-50/60" : ""
                      }`}
                    >
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(order.id);
                          }}
                          aria-expanded={open}
                          aria-label={open ? "Hide logs" : "Show logs"}
                          title={open ? "Hide logs" : "Show logs"}
                          className="rounded border border-surface-border p-0.5 text-slate-500 hover:bg-white hover:text-brand-700"
                        >
                          <Chevron open={open} />
                        </button>
                      </td>
                      <td className={`${td} max-w-[180px] truncate text-slate-700`} title={order.store_name}>
                        {order.store_name || "—"}
                      </td>
                      <td className={`${td} whitespace-nowrap font-semibold text-slate-900`}>
                        {String(order.order_number ?? "").replace(/^#/, "") || "—"}
                      </td>
                      <td className={`${td} whitespace-nowrap text-slate-700`}>{order.supabase_order_no ?? "—"}</td>
                      <td className={`${td} whitespace-nowrap text-slate-600`}>
                        {formatDateTime(order.placed_at || order.created_at) || "—"}
                      </td>
                      <td className={`${td} max-w-[180px] truncate text-slate-700`} title={order.customer_name}>
                        {order.customer_name || "—"}
                      </td>
                      <td className={`${td} text-slate-700`}>{order.city || "—"}</td>
                      <td className={`${td} whitespace-nowrap text-slate-700`}>
                        <div>{order.courier_name || "—"}</div>
                        {order.tracking_number ? (
                          <div className="text-[11px] text-slate-400">{order.tracking_number}</div>
                        ) : null}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {statusOf(order)}
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-b border-surface-border bg-slate-50">
                        <td />
                        <td colSpan={COLS - 1} className="px-3 py-4">
                          <OrderHistory orderId={order.id} fetchOrderLogs={fetchOrderLogs} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        count={count}
        itemLabel="orders"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
