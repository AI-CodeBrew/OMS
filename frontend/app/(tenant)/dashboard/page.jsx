"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import ordersService from "../../../services/ordersService";
import { connectOrdersSocket } from "../../../lib/ordersSocket";
import {
  dashboardKey,
  dashboardPresetsAreWarm,
  dashboardPresetKeys,
  dashboardRangeFor,
  getCachedDashboard,
  invalidateViewCache,
  setCachedDashboard,
} from "../../../lib/viewCache";
import { warmupViewsInBackground } from "../../../lib/warmupViews";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import Dropdown from "../../../components/shared/Dropdown";

// recharts is a large library - loading it on demand instead of eagerly
// means the KPI cards and header below render immediately on the very
// first page every user sees after login, instead of waiting on the
// whole charting bundle to download and parse first.
const DashboardCharts = dynamic(() => import("../../../components/dashboard/DashboardCharts"), {
  ssr: false,
  loading: () => (
    <div className="mt-4 h-[260px] animate-pulse rounded-lg border border-surface-border bg-surface" />
  ),
});

const KPI_GROUPS = [
  { key: "total", label: "Total Orders", statuses: null, color: "#1e40af" },
  {
    key: "pending",
    label: "Pending",
    statuses: ["pending_cc", "pending_cod", "city_issue", "awaiting_assigning", "awaiting_approval"],
    color: "#f59e0b",
  },
  {
    key: "dispatched",
    label: "Dispatched",
    statuses: ["approved", "awaiting_dispatched", "dispatched", "dispatch_issue"],
    color: "#2563eb",
  },
  { key: "delivered", label: "Delivered", statuses: ["delivered"], color: "#16a34a" },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"], color: "#ef4444" },
  { key: "returned", label: "Returned", statuses: ["returned"], color: "#f97316" },
];

// Keep the day counts in step with dashboardPresetKeys (lib/viewCache.js),
// which warms each of these in the background.
const QUICK_RANGES = [
  { key: "1", label: "1 Day", days: 1 },
  { key: "2", label: "2 Days", days: 2 },
  { key: "7", label: "1 Week", days: 7 },
  { key: "14", label: "2 Weeks", days: 14 },
  { key: "30", label: "30 Days", days: 30 },
  { key: "90", label: "90 Days", days: 90 },
  { key: "all", label: "All Time", days: null },
];

function KpiCard({ label, value, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show these orders`}
      className="rounded-lg border border-surface-border bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold" style={{ color }}>
        {value == null ? "—" : value.toLocaleString()}
      </p>
    </button>
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
  // The range lives in the URL too, so coming back from Orders (its ← arrow
  // is a browser Back) lands on the same range rather than the default.
  const [activeRange, setActiveRange] = useState(() =>
    QUICK_RANGES.some((r) => r.key === searchParams.get("range")) ? searchParams.get("range") : "7"
  );
  const [customRange, setCustomRange] = useState(() => {
    const date_from = searchParams.get("date_from") || "";
    const date_to = searchParams.get("date_to") || "";
    return date_from || date_to ? { date_from, date_to } : null;
  });

  function rememberRange(query) {
    router.replace(`/dashboard?${new URLSearchParams(query).toString()}`, { scroll: false });
  }

  function openOrders(group) {
    const query = new URLSearchParams({ from: "dashboard", group: group.label });
    if (group.statuses) query.set("status", group.statuses.join(","));
    if (params.date_from) query.set("date_from", params.date_from);
    if (params.date_to) query.set("date_to", params.date_to);
    router.push(`/orders?${query.toString()}`);
  }
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reloadTimer = useRef(null);
  const loadGen = useRef(0);

  const params = useMemo(() => {
    if (customRange) return customRange;
    const preset = QUICK_RANGES.find((r) => r.key === activeRange);
    return dashboardRangeFor(preset ? preset.days : 7);
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
        // Fetch just this range and paint it. Previously this awaited
        // warmupViews(), which also loads all 17 Orders tabs - the
        // dashboard was waiting on work it does not display. The warmup
        // still runs, below, once there is something on screen.
        const d = await ordersService.dashboard(params);
        if (cancelled || gen !== loadGen.current) return;
        setCachedDashboard(key, d);
        setData(d);
      } catch (err) {
        if (!cancelled && gen === loadGen.current) setError(err.message || "Failed to load dashboard");
      } finally {
        if (!cancelled && gen === loadGen.current) setLoading(false);
      }

      // Warm the Orders tabs and the other dashboard presets now that this
      // range is on screen, so moving to Orders or switching preset is a
      // cache hit rather than another cold round-trip.
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

  const statusBreakdown = data?.status_breakdown || {};
  const kpis = KPI_GROUPS.map((g) => ({
    ...g,
    value: g.statuses ? g.statuses.reduce((sum, s) => sum + (statusBreakdown[s] || 0), 0) : data?.total_orders || 0,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Order activity and COD collection overview.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Dropdown
            align="right"
            trigger={
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${
                  customRange
                    ? "border-surface-border bg-white text-slate-500"
                    : "border-brand-800 bg-brand-800 text-white"
                }`}
              >
                {customRange ? "Quick range" : QUICK_RANGES.find((r) => r.key === activeRange)?.label}
                <span className="text-xs">▾</span>
              </span>
            }
            items={QUICK_RANGES.map((r) => ({
              key: r.key,
              label: !customRange && activeRange === r.key ? `✓ ${r.label}` : r.label,
              onClick: () => {
                setCustomRange(null);
                setActiveRange(r.key);
                rememberRange({ range: r.key });
              },
            }))}
          />
          <DateRangeFilter
            dateFrom={customRange?.date_from}
            dateTo={customRange?.date_to}
            onApplyDateRange={(date_from, date_to) => {
              if (!date_from && !date_to) return;
              setCustomRange({ date_from: date_from || "", date_to: date_to || "" });
              rememberRange({ date_from: date_from || "", date_to: date_to || "" });
            }}
            onClearDateRange={() => {
              setCustomRange(null);
              rememberRange({ range: activeRange });
            }}
          />
        </div>
      </div>

      {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(loading ? KPI_GROUPS.map((k) => ({ ...k, value: null })) : kpis).map((k) => (
          <KpiCard key={k.key} label={k.label} value={k.value} color={k.color} onClick={() => openOrders(k)} />
        ))}
      </div>

      {loading ? (
        <div className="mt-4 h-[260px] rounded-lg border border-surface-border bg-surface" />
      ) : (
        <DashboardCharts data={data} />
      )}
    </div>
  );
}
