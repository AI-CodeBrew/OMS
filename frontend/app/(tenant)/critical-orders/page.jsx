"use client";

import useOrderNav from "../../../components/orders/useOrderNav";
import usePageAccess from "../../../lib/usePageAccess";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Pagination from "../../../components/shared/Pagination";
import SearchBox from "../../../components/shared/SearchBox";
import OrdersTable from "../../../components/orders/OrdersTable";
import CsvExportButton from "../../../components/orders/CsvExportButton";
import AutoAdviceBar from "../../../components/orders/AutoAdviceBar";
import ordersService from "../../../services/ordersService";
import couriersService from "../../../services/couriersService";
import { useEffectiveUser } from "../../../store/authStore";
import { useRememberedData, useRememberedState } from "../../../lib/pageMemory";

const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});

// Card accents, by reason - red for what's already late/failed, amber for
// what needs a hand before it can move on.
const REASON_TONE = {
  city_address_issue: "border-l-amber-500",
  contact_issue: "border-l-amber-500",
  assigning_24h: "border-l-amber-500",
  in_transit: "border-l-red-500",
  returning_15d: "border-l-red-500",
};

// Orders that need attention, by reason (backend: oms.services.
// CRITICAL_REASONS) - a card per reason with its count; the picked card's
// orders are listed below. ?reason=<key> opens straight on one (the
// critical-orders alert links to in_transit).
export default function CriticalOrdersPage() {
  const { canWrite } = usePageAccess("oms.critical_orders");
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useEffectiveUser();
  // Back to this page: the cards and the list as they were left, shown at
  // once and refreshed quietly (user, 2026-11-24).
  const { recall, remember } = useRememberedData("critical");
  const [reasons, setReasons] = useState(() => recall()?.reasons || null);
  const [active, setActive] = useState(searchParams.get("reason") || "");
  const [page, setPage] = useRememberedState("page", 1);
  const [pageSize, setPageSize] = useRememberedState("pageSize", 10);
  const listKey = (reason, pg, size, q) => `${reason}|${pg}|${size}|${q}`;
  // The same search as All Orders (order no., customer, phone, product,
  // SKU, tracking, city; commas for several) - within the picked card.
  const [search, setSearch] = useRememberedState("search", "");
  const [appliedSearch, setAppliedSearch] = useRememberedState("appliedSearch", "");
  const [arrival] = useState(() => recall()?.lists?.[listKey(active, page, pageSize, appliedSearch)] || null);
  const [orders, setOrders] = useState(() => arrival?.orders || []);
  const [count, setCount] = useState(() => arrival?.count || 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailOrderId, setDetailOrderId] = useState(null);
  // The details panel's previous / next arrows step through this list.
  // (Below `orders` - used above its declaration it crashed the page.)
  const orderNav = useOrderNav(orders, detailOrderId, setDetailOrderId);
  const [couriers, setCouriers] = useState([]);

  const loadSummary = useCallback(async () => {
    try {
      const data = await ordersService.criticalSummary();
      setReasons(data.reasons || []);
      remember({ ...(recall() || {}), reasons: data.reasons || [] });
      // Nothing picked yet: open on the first reason that has orders.
      setActive((current) => current || (data.reasons || []).find((r) => r.count > 0)?.key || "");
    } catch (err) {
      setError(err.message || "Failed to load critical orders");
      setReasons([]);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    if (!active) {
      setOrders([]);
      setCount(0);
      return;
    }
    const key = listKey(active, page, pageSize, appliedSearch);
    const cached = recall()?.lists?.[key];
    if (cached) {
      // Seen before: its rows at once, refreshed quietly below.
      setOrders(cached.orders);
      setCount(cached.count);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const data = await ordersService.list({
        critical_reason: active,
        page,
        page_size: pageSize,
        search: appliedSearch || undefined,
        search_field: appliedSearch ? "all" : undefined,
      });
      setOrders(data.results || []);
      setCount(data.count || 0);
      const memory = recall() || {};
      remember({ ...memory, lists: { ...(memory.lists || {}), [key]: { orders: data.results || [], count: data.count || 0 } } });
    } catch (err) {
      setError(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, page, pageSize, appliedSearch]);

  useEffect(() => {
    loadSummary();
    couriersService.list().then(setCouriers).catch(() => {});
  }, [loadSummary]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  function pick(key) {
    setActive(key);
    setPage(1);
    router.replace(`/critical-orders?reason=${key}`);
  }

  const activeReason = (reasons || []).find((r) => r.key === active);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900" title={"Orders that need attention, by reason. Pick a card to see its orders."}>Critical Orders</h1>
        {/* Export the picked card's orders - all of them, or one courier's. */}
        {active ? (
          <CsvExportButton
            filterParams={{
              critical_reason: active,
              ...(appliedSearch ? { search: appliedSearch, search_field: "all" } : {}),
            }}
            allAndCourierOnly
            filePrefix={`critical_${active}`}
          />
        ) : null}
      </div>

      {/* One row of small cards, like the All Orders status tabs. */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {(reasons || Array.from({ length: 6 }, (_, i) => ({ key: `loading-${i}` }))).map((r) => {
          const isActive = r.key === active;
          const loaded = r.count !== undefined;
          return (
            <button
              key={r.key}
              type="button"
              disabled={!loaded}
              onClick={() => pick(r.key)}
              title={r.description}
              className={`flex flex-1 shrink-0 items-center justify-between gap-3 rounded-md border border-l-4 px-2.5 py-1.5 text-left transition ${
                REASON_TONE[r.key] || "border-l-slate-300"
              } ${isActive ? "border-brand-600 bg-brand-50" : "border-surface-border bg-white hover:border-slate-300"}`}
            >
              <span
                className={`whitespace-nowrap text-[10px] font-medium uppercase leading-tight ${
                  isActive ? "text-brand-700" : "text-slate-500"
                }`}
              >
                {r.label || "…"}
              </span>
              <span
                className={`text-base font-semibold tabular-nums ${
                  isActive
                    ? "text-brand-700"
                    : !loaded
                      ? "text-slate-200"
                      : r.count
                        ? "text-slate-900"
                        : "text-slate-300"
                }`}
              >
                {loaded ? r.count : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-3">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          {activeReason ? (
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">{activeReason.label}</h2>
              <p className="text-sm text-slate-500">{activeReason.description}</p>
            </div>
          ) : (
            <div />
          )}
          {active ? (
            <SearchBox
              value={search}
              onChange={setSearch}
              onSearch={(term) => {
                setAppliedSearch(term);
                setPage(1);
              }}
              suggestions={orders.flatMap((o) => [o.order_number, o.customer_name, o.tracking_number])}
              getSuggestions={ordersService.suggestProductNames.bind(ordersService)}
              placeholder="Search order, customer, phone, product…"
              title="Searches this card's orders by order no., customer, phone, product, SKU, tracking and city. Separate multiple values with commas, e.g. 87364,7386473,8343"
              className="w-full sm:w-auto"
              inputClassName="w-full flex-1 sm:w-72 sm:flex-none"
            />
          ) : null}
        </div>
        {/* Shipper Advice Needed: the Auto Reattempt switch - this store's,
            or in the Dispatch Hub every Hub store's (backend oms.auto_advice). */}
        {active === "shipper_advice" ? (
          <AutoAdviceBar
            canWrite={canWrite}
            refreshKey={activeReason?.count}
            onOpenOrder={setDetailOrderId}
          />
        ) : null}
        {appliedSearch && !loading && orders.length === 0 && active ? (
          <p className="mb-3 rounded-md bg-surface px-3 py-2 text-sm text-slate-600">
            No orders in this card match &quot;{appliedSearch}&quot;.
          </p>
        ) : null}

        {active ? (
          <>
            <OrdersTable
              orders={orders}
              loading={loading}
              selectedIds={new Set()}
              onToggleSelect={() => {}}
              onToggleSelectAll={() => {}}
              onOpenDetail={setDetailOrderId}
              showStoreColumn={Boolean(user?.isDispatchHub)}
              showTransitColumn={active === "in_transit"}
              showSubStatusColumn
            />
            {orders.length > 0 ? (
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
          </>
        ) : reasons ? (
          <p className="rounded-lg border border-surface-border bg-white px-4 py-8 text-center text-sm text-slate-500">
            Nothing critical right now.
          </p>
        ) : null}
      </div>

      <OrderDetailPanel
        orderId={detailOrderId}
        onPrev={orderNav.onPrev}
        onNext={orderNav.onNext}
        position={orderNav.position}
        couriers={couriers}
        readOnly={!canWrite}
        onClose={() => setDetailOrderId(null)}
        onOrderChanged={() => {
          loadOrders();
          loadSummary();
        }}
      />
    </div>
  );
}
