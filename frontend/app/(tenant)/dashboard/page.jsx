"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import ordersService from "../../../services/ordersService";

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

function toDateInputValue(d) {
  return d.toISOString().slice(0, 10);
}

function rangeFor(days) {
  const to = new Date();
  const from = new Date();
  if (days !== null) from.setDate(to.getDate() - (days - 1));
  return { date_from: days === null ? "" : toDateInputValue(from), date_to: toDateInputValue(to) };
}

const QUICK_RANGES = [
  { key: "7", label: "1 Week", days: 7 },
  { key: "30", label: "30 Days", days: 30 },
  { key: "90", label: "90 Days", days: 90 },
  { key: "all", label: "All Time", days: null },
];

function KpiCard({ label, value, color }) {
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold" style={{ color }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const [activeRange, setActiveRange] = useState("30");
  const [customRange, setCustomRange] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    if (customRange) return customRange;
    const preset = QUICK_RANGES.find((r) => r.key === activeRange);
    return rangeFor(preset ? preset.days : 30);
  }, [activeRange, customRange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    ordersService
      .dashboard(params)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

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
          {QUICK_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                setCustomRange(null);
                setActiveRange(r.key);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                !customRange && activeRange === r.key
                  ? "border-brand-800 bg-brand-800 text-white"
                  : "border-surface-border bg-white text-slate-600 hover:bg-surface"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {loading && !data ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {kpis.map((k) => (
              <KpiCard key={k.key} label={k.label} value={k.value} color={k.color} />
            ))}
          </div>

          <DashboardCharts data={data} />
        </>
      )}
    </div>
  );
}
