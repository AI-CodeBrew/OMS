"use client";

// Split out of the Dashboard page on purpose: recharts is a large library,
// and the Dashboard is the very first thing every user sees after login -
// this file is loaded via next/dynamic so the KPI cards/header render
// immediately and the charts load in right behind them.
//
// Top couriers (left) and Top Cities (right). Orders by Status and the COD
// Collection Rate gauge were taken off for now - they're in git history.

import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from "recharts";

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

// topCouriers: the Top couriers card (DeliveryPerformance - bars by share
// of orders, click for provinces), shown beside Top Cities.
export default function DashboardCharts({ data, topCouriers = null }) {
  const cityChartData = (data?.city_breakdown || []).map((row) => ({ city: row.city, count: row.count }));

  return (
    <>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {topCouriers}
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
      </div>
    </>
  );
}
