"use client";

// Split out of the Dashboard page on purpose: recharts is a large library,
// and the Dashboard is the very first thing every user sees after login -
// loading it eagerly meant everyone paid for the whole charting bundle
// before the page could paint anything, KPI cards included. This file is
// loaded via next/dynamic from the page instead, so the KPI cards/header
// render immediately and the charts (genuinely the slower part) load in
// right behind them rather than blocking first paint.

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
import { STATUS_LABELS } from "../orders/statusConfig";

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

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
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

export default function DashboardCharts({ data }) {
  const statusBreakdown = data?.status_breakdown || {};
  const statusChartData = Object.entries(statusBreakdown)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      status: STATUS_LABELS[status] || status,
      count,
      fill: STATUS_COLORS[status] || "#64748b",
    }));

  const cityChartData = (data?.city_breakdown || []).map((row) => ({ city: row.city, count: row.count }));
  const courierChartData = (data?.courier_breakdown || []).map((row) => ({ name: row.name, count: row.count }));

  const collected = Number(data?.cod_summary?.collected || 0);
  const grandTotal = Number(data?.cod_summary?.grand_total || 0);
  const collectionRate = grandTotal > 0 ? Math.round((collected / grandTotal) * 100) : 0;
  const gaugeData = [{ name: "Collected", value: collectionRate, fill: "#2563eb" }];

  return (
    <>
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
  );
}
