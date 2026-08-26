"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  RadialBarChart,
  RadialBar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import ordersService from "../../../services/ordersService";
import { STATUS_LABELS } from "../../../components/orders/statusConfig";

const STATUS_COLORS = {
  pending_cc: "#f59e0b",
  pending_cod: "#f59e0b",
  city_issue: "#ef4444",
  awaiting_assigning: "#a855f7",
  awaiting_approval: "#a855f7",
  approved: "#0ea5e9",
  dispatch_issue: "#ef4444",
  awaiting_dispatched: "#0ea5e9",
  dispatched: "#2563eb",
  delivered: "#16a34a",
  cancelled: "#ef4444",
  returned: "#f97316",
};

const PIE_COLORS = ["#2563eb", "#0ea5e9", "#16a34a", "#f59e0b", "#a855f7", "#f97316", "#ef4444", "#64748b"];

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

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

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

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
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

  const statusChartData = Object.entries(statusBreakdown)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status: STATUS_LABELS[status] || status, count, fill: STATUS_COLORS[status] || "#64748b" }));

  const cityChartData = (data?.city_breakdown || []).map((row) => ({ city: row.city, count: row.count }));
  const courierChartData = (data?.courier_breakdown || []).map((row) => ({ name: row.name, count: row.count }));

  const collected = Number(data?.cod_summary?.collected || 0);
  const grandTotal = Number(data?.cod_summary?.grand_total || 0);
  const collectionRate = grandTotal > 0 ? Math.round((collected / grandTotal) * 100) : 0;
  const gaugeData = [{ name: "Collected", value: collectionRate, fill: "#2563eb" }];

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

          <div className="mt-4">
            <ChartCard title="Orders Over Time" subtitle="Daily order volume for the selected range">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data?.trend || []}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} fill="url(#trendFill)" name="Orders" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Orders by Status" subtitle="Count of orders in each pipeline stage">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={statusChartData} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="status"
                    tick={{ fontSize: 11, fill: "#334155" }}
                    tickLine={false}
                    axisLine={false}
                    width={110}
                  />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {statusChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="COD Collection Rate" subtitle="Amount collected vs. total order value">
              <div className="relative">
                <ResponsiveContainer width="100%" height={280}>
                  <RadialBarChart
                    innerRadius="70%"
                    outerRadius="100%"
                    data={gaugeData}
                    startAngle={90}
                    endAngle={-270}
                  >
                    <RadialBar dataKey="value" cornerRadius={12} background={{ fill: "#eef2f7" }} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-brand-700">{collectionRate}%</span>
                  <span className="mt-1 text-xs text-slate-500">Rs {formatMoney(collected)} of Rs {formatMoney(grandTotal)}</span>
                </div>
              </div>
            </ChartCard>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Top Cities" subtitle="Order volume by delivery city">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cityChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="city" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top Couriers" subtitle="Order volume by assigned courier">
              {courierChartData.length === 0 ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">
                  No courier assignments yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={courierChartData}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {courierChartData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
