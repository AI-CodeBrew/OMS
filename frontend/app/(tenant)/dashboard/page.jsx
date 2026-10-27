"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import ordersService from "../../../services/ordersService";
import couriersService from "../../../services/couriersService";
import { connectOrdersSocket } from "../../../lib/ordersSocket";
import {
  DASHBOARD_PRESETS,
  dashboardKey,
  dashboardPresetsAreWarm,
  dashboardPresetKeys,
  dashboardRangeForPreset,
  getCachedDashboard,
  invalidateViewCache,
  setCachedDashboard,
} from "../../../lib/viewCache";
import { warmupViewsInBackground } from "../../../lib/warmupViews";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import OrdersTable from "../../../components/orders/OrdersTable";
import { useEffectiveUser } from "../../../store/authStore";
import DeliveryPerformance from "../../../components/dashboard/DeliveryPerformance";

// recharts is a large library - loading it on demand instead of eagerly
// means the KPI cards and header render immediately on the very first page
// every user sees after login, instead of waiting on the charting bundle.
const DashboardCharts = dynamic(() => import("../../../components/dashboard/DashboardCharts"), {
  ssr: false,
  loading: () => (
    <div className="mt-4 h-[260px] animate-pulse rounded-lg border border-surface-border bg-surface" />
  ),
});

const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});

// Card order: Total, Pending, Cancelled, then the rest of the pipeline.
const KPI_GROUPS = [
  { key: "total", label: "Total Orders", statuses: null, color: "#1e40af" },
  {
    key: "pending",
    label: "Pending",
    statuses: ["pending_cc", "pending_cod", "city_issue", "awaiting_assigning", "awaiting_approval"],
    color: "#f59e0b",
  },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"], color: "#ef4444" },
  {
    key: "dispatched",
    label: "Dispatched",
    statuses: ["approved", "awaiting_dispatched", "dispatched", "dispatch_issue"],
    color: "#2563eb",
  },
  { key: "delivered", label: "Delivered", statuses: ["delivered"], color: "#16a34a" },
  { key: "returned", label: "Returned", statuses: ["returned"], color: "#f97316" },
];

// The date filter's choices (RangeDropdown): Today / Yesterday / Last 7 /
// Last 30 days (each warmed in the background - see DASHBOARD_PRESETS) and
// Custom.
const RANGE_BUTTONS = [...DASHBOARD_PRESETS, { key: "custom", label: "Custom" }];
const DEFAULT_RANGE = "30";

function KpiCard({ label, value, color, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show these orders below"
      className={`rounded-lg border bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
        active ? "border-brand-600 ring-2 ring-brand-200" : "border-surface-border"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold" style={{ color }}>
        {value == null ? "—" : value.toLocaleString()}
      </p>
    </button>
  );
}

// The Dashboard's one date filter, top right: a button showing the range,
// opening the presets and Custom - whose dates and Apply appear right in
// the same panel. Stays open while Custom is being filled in.
function RangeDropdown({ activeRange, rangeLabel, customDraft, onDraftChange, onPick, onApplyCustom }) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(activeRange === "custom");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const dateInput =
    "w-full rounded-md border border-surface-border px-2.5 py-1.5 text-sm outline-none focus:border-brand-500";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-slate-400" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {rangeLabel}
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-surface-border bg-white py-1 shadow-lg">
          {RANGE_BUTTONS.map((r) => {
            const selected = r.key === activeRange;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  if (r.key === "custom") {
                    setShowCustom(true);
                    onPick("custom");
                    return;
                  }
                  setShowCustom(false);
                  onPick(r.key);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-surface ${
                  selected ? "font-medium text-brand-800" : "text-slate-700"
                }`}
              >
                {r.label}
                {selected ? <span className="text-brand-700">✓</span> : null}
              </button>
            );
          })}
          {showCustom ? (
            <div className="mt-1 space-y-2 border-t border-surface-border px-3 pb-2 pt-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
                <input
                  type="date"
                  value={customDraft.date_from}
                  onChange={(e) => onDraftChange((d) => ({ ...d, date_from: e.target.value }))}
                  className={dateInput}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
                <input
                  type="date"
                  value={customDraft.date_to}
                  onChange={(e) => onDraftChange((d) => ({ ...d, date_to: e.target.value }))}
                  className={dateInput}
                />
              </label>
              <Button
                className="w-full"
                disabled={!customDraft.date_from && !customDraft.date_to}
                onClick={() => {
                  onApplyCustom();
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// useSearchParams needs a Suspense boundary above it for Next's build.
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useEffectiveUser();
  // The range lives in the URL too, so a reload keeps it.
  const [activeRange, setActiveRange] = useState(() =>
    RANGE_BUTTONS.some((r) => r.key === searchParams.get("range")) ? searchParams.get("range") : DEFAULT_RANGE
  );
  const [customRange, setCustomRange] = useState(() => {
    const date_from = searchParams.get("date_from") || "";
    const date_to = searchParams.get("date_to") || "";
    return date_from || date_to ? { date_from, date_to } : null;
  });
  const [customDraft, setCustomDraft] = useState(() => customRange || { date_from: "", date_to: "" });

  function rememberRange(query) {
    router.replace(`/dashboard?${new URLSearchParams(query).toString()}`, { scroll: false });
  }

  function pickRange(key) {
    setActiveRange(key);
    if (key === "custom") return; // waits for its dates + Apply below
    setCustomRange(null);
    rememberRange({ range: key });
  }

  function applyCustom() {
    if (!customDraft.date_from && !customDraft.date_to) return;
    setCustomRange({ ...customDraft });
    rememberRange({ range: "custom", ...customDraft });
  }

  // A card's orders are listed right here under the cards, not on All
  // Orders - clicking the same card again closes them.
  const [openGroup, setOpenGroup] = useState(null);
  const [groupOrders, setGroupOrders] = useState([]);
  const [groupCount, setGroupCount] = useState(0);
  const [groupPage, setGroupPage] = useState(1);
  const [groupPageSize, setGroupPageSize] = useState(10);
  const [groupLoading, setGroupLoading] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState(null);
  const [couriers, setCouriers] = useState([]);

  function openOrders(group) {
    setGroupPage(1);
    setOpenGroup((current) => (current?.key === group.key ? null : group));
  }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reloadTimer = useRef(null);
  const loadGen = useRef(0);

  // Custom with nothing applied yet keeps showing the default range.
  const params = useMemo(() => {
    if (customRange) return customRange;
    return dashboardRangeForPreset(activeRange === "custom" ? DEFAULT_RANGE : activeRange);
  }, [activeRange, customRange]);

  const isPreset = !customRange;

  useEffect(() => {
    let cancelled = false;
    const gen = ++loadGen.current;
    const key = dashboardKey(params);

    async function load(force) {
      setError("");
      if (!force && isPreset && dashboardPresetsAreWarm()) {
        setData(getCachedDashboard(key));
        setLoading(false);
        return;
      }
      if (!force && !isPreset) {
        const cached = getCachedDashboard(key);
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }
      }
      if (!force) {
        setLoading(true);
        setData(null);
      }
      try {
        // Fetch just this range and paint it - the warmup of the Orders
        // tabs and the other ranges runs below, once this is on screen.
        const d = await ordersService.dashboard(params);
        if (cancelled || gen !== loadGen.current) return;
        setCachedDashboard(key, d);
        setData(d);
      } catch (err) {
        if (!cancelled && gen === loadGen.current) setError(err.message || "Failed to load dashboard");
      } finally {
        if (!cancelled && gen === loadGen.current) setLoading(false);
      }

      warmupViewsInBackground({ dashKeys: dashboardPresetKeys() });
    }

    load(false);
    return () => {
      cancelled = true;
    };
  }, [params, isPreset]);

  useEffect(() => {
    const cleanup = connectOrdersSocket(() => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(async () => {
        invalidateViewCache();
        const key = dashboardKey(params);
        try {
          // Refresh what is on screen first, exactly as the initial load
          // does - the visible range must not wait on the full warmup.
          const d = await ordersService.dashboard(params);
          setCachedDashboard(key, d);
          setData(d);
          setLoading(false);
        } catch (err) {
          setError(err.message || "Failed to load dashboard");
        }
        warmupViewsInBackground({ dashKeys: dashboardPresetKeys() });
      }, 300);
    });
    return () => {
      clearTimeout(reloadTimer.current);
      cleanup();
    };
  }, [params, isPreset]);

  useEffect(() => {
    couriersService.list().then(setCouriers).catch(() => {});
  }, []);

  const loadGroupOrders = useCallback(async () => {
    if (!openGroup) return;
    setGroupLoading(true);
    try {
      const result = await ordersService.list({
        ...(openGroup.statuses ? { status: openGroup.statuses.join(",") } : {}),
        date_from: params.date_from || undefined,
        date_to: params.date_to || undefined,
        page: groupPage,
        page_size: groupPageSize,
      });
      setGroupOrders(result.results || []);
      setGroupCount(result.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load orders");
    } finally {
      setGroupLoading(false);
    }
  }, [openGroup, params, groupPage, groupPageSize]);

  useEffect(() => {
    if (openGroup) loadGroupOrders();
    else setGroupOrders([]);
  }, [openGroup, loadGroupOrders]);

  // A new range keeps the open card, back on its first page.
  useEffect(() => {
    setGroupPage(1);
  }, [params]);

  const statusBreakdown = data?.status_breakdown || {};
  const kpis = KPI_GROUPS.map((g) => ({
    ...g,
    value: g.statuses ? g.statuses.reduce((sum, s) => sum + (statusBreakdown[s] || 0), 0) : data?.total_orders || 0,
  }));

  const rangeLabel = customRange
    ? `${customRange.date_from || "Start"} to ${customRange.date_to || "Today"}`
    : RANGE_BUTTONS.find((r) => r.key === (activeRange === "custom" ? DEFAULT_RANGE : activeRange))?.label;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Order activity and COD collection overview.</p>
        </div>
        <RangeDropdown
          activeRange={activeRange}
          rangeLabel={rangeLabel}
          customDraft={customDraft}
          onDraftChange={setCustomDraft}
          onPick={pickRange}
          onApplyCustom={applyCustom}
        />
      </div>

      {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(loading ? KPI_GROUPS.map((k) => ({ ...k, value: null })) : kpis).map((k) => (
          <KpiCard
            key={k.key}
            label={k.label}
            value={k.value}
            color={k.color}
            active={openGroup?.key === k.key}
            onClick={() => openOrders(k)}
          />
        ))}
      </div>

      {openGroup ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              {openGroup.label} <span className="font-normal text-slate-500">· {rangeLabel}</span>
            </h2>
            <button
              type="button"
              onClick={() => setOpenGroup(null)}
              className="text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              ✕ Close
            </button>
          </div>
          <OrdersTable
            orders={groupOrders}
            loading={groupLoading}
            selectedIds={new Set()}
            onToggleSelect={() => {}}
            onToggleSelectAll={() => {}}
            onOpenDetail={setDetailOrderId}
            showStoreColumn={Boolean(user?.isDispatchHub)}
          />
          {groupOrders.length > 0 ? (
            <Pagination
              page={groupPage}
              pageSize={groupPageSize}
              count={groupCount}
              onPageChange={setGroupPage}
              onPageSizeChange={(size) => {
                setGroupPageSize(size);
                setGroupPage(1);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-5 h-[260px] animate-pulse rounded-lg border border-surface-border bg-surface" />
      ) : (
        <DashboardCharts
          data={data}
          topCouriers={<DeliveryPerformance data={data?.delivery_performance} />}
        />
      )}

      <OrderDetailPanel
        orderId={detailOrderId}
        couriers={couriers}
        onClose={() => setDetailOrderId(null)}
        onOrderChanged={loadGroupOrders}
      />
    </div>
  );
}
