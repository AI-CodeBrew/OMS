"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Pagination from "../../../components/shared/Pagination";
import OrdersTable from "../../../components/orders/OrdersTable";
import ordersService from "../../../services/ordersService";
import couriersService from "../../../services/couriersService";
import { useEffectiveUser } from "../../../store/authStore";

const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});

// Card accents, by reason - red for what's already late/failed, amber for
// what needs a hand before it can move on.
const REASON_TONE = {
  in_transit: "border-l-red-500",
  attempt: "border-l-red-500",
  dispatch_issue: "border-l-amber-500",
  city_issue: "border-l-amber-500",
  stuck_booking: "border-l-amber-500",
  courier_cancelled: "border-l-amber-500",
};

// Orders that need attention, by reason (backend: oms.services.
// CRITICAL_REASONS) - a card per reason with its count; the picked card's
// orders are listed below. ?reason=<key> opens straight on one (the
// critical-orders alert links to in_transit).
export default function CriticalOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useEffectiveUser();
  const [reasons, setReasons] = useState(null);
  const [active, setActive] = useState(searchParams.get("reason") || "");
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailOrderId, setDetailOrderId] = useState(null);
  const [couriers, setCouriers] = useState([]);

  const loadSummary = useCallback(async () => {
    try {
      const data = await ordersService.criticalSummary();
      setReasons(data.reasons || []);
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
    setLoading(true);
    setError("");
    try {
      const data = await ordersService.list({ critical_reason: active, page, page_size: pageSize });
      setOrders(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [active, page, pageSize]);

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
      <div>
        <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Critical Orders</h1>
        <p className="mt-1 text-sm text-slate-500">
          Orders that need attention, by reason. Pick a card to see its orders.
        </p>
      </div>

      {/* One row of small cards, like the All Orders status tabs. */}
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
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
              className={`relative h-[60px] min-w-[128px] flex-1 shrink-0 rounded-md border border-l-4 text-left transition ${
                REASON_TONE[r.key] || "border-l-slate-300"
              } ${isActive ? "border-brand-600 bg-brand-50" : "border-surface-border bg-white hover:border-slate-300"}`}
            >
              <div
                className={`absolute left-2 right-2 top-2 text-[10px] font-medium uppercase leading-tight ${
                  isActive ? "text-brand-700" : "text-slate-500"
                }`}
              >
                {r.label || "…"}
              </div>
              <div
                className={`absolute bottom-1.5 right-2 text-lg font-semibold ${
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
              </div>
            </button>
          );
        })}
      </div>

      {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-6">
        {activeReason ? (
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-900">{activeReason.label}</h2>
            <p className="text-sm text-slate-500">{activeReason.description}</p>
          </div>
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
        couriers={couriers}
        onClose={() => setDetailOrderId(null)}
        onOrderChanged={() => {
          loadOrders();
          loadSummary();
        }}
      />
    </div>
  );
}
