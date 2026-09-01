"use client";

import { useCallback, useEffect, useState } from "react";
import reportsService from "../../../services/reportsService";
import Button from "../../../components/shared/Button";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";

const EMPTY_SUMMARY = {
  total_orders: 0,
  new: 0,
  pending: 0,
  awaiting_assigning: 0,
  ready_to_print: 0,
  dispatched: 0,
  delivered: 0,
  returned: 0,
  cancelled: 0,
};

const TILES = [
  { key: "total_orders", label: "Total Orders" },
  { key: "new", label: "New" },
  { key: "pending", label: "Pending" },
  { key: "awaiting_assigning", label: "Awaiting Assigning" },
  { key: "ready_to_print", label: "Ready to Print" },
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered", label: "Delivered", tone: "green" },
  { key: "returned", label: "Returned", tone: "red" },
  { key: "cancelled", label: "Cancelled", tone: "muted" },
];

function Tile({ label, value, tone }) {
  const tones = {
    green: "text-emerald-600",
    red: "text-red-600",
    muted: "text-slate-400",
  };
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone] || "text-slate-900"}`}>{value}</p>
    </div>
  );
}

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await reportsService.getSummary({ dateFrom, dateTo });
      setSummary(data);
    } catch (err) {
      setError(err.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  async function onDownloadCsv() {
    setDownloading(true);
    setError("");
    try {
      await reportsService.downloadCsv({ dateFrom, dateTo });
    } catch (err) {
      setError(err.message || "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Order totals by status for any date range - download as CSV for a day-by-day
            breakdown.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onApplyDateRange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
            onClearDateRange={() => {
              setDateFrom("");
              setDateTo("");
            }}
          />
          <Button onClick={onDownloadCsv} disabled={downloading}>
            {downloading ? "Preparing…" : "Download CSV"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading
          ? Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-lg border border-surface-border bg-surface" />
            ))
          : TILES.map((t) => (
              <Tile key={t.key} label={t.label} value={summary[t.key] ?? 0} tone={t.tone} />
            ))}
      </div>
    </div>
  );
}
