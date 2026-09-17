"use client";

import { useCallback, useEffect, useState } from "react";
import reportsService from "../../../services/reportsService";
import ordersService from "../../../services/ordersService";
import wmsService from "../../../services/wmsService";
import Button from "../../../components/shared/Button";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";

const EMPTY_ORDERS = {
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

const EMPTY_WMS = {
  total_skus: 0,
  low_count: 0,
  negative_count: 0,
  units_dispatched: 0,
  units_restocked: 0,
  manual_adjustments: 0,
};

const EMPTY_RETURNS = {
  total_returns: 0,
  return_in_progress: 0,
  awaiting_scan: 0,
  received: 0,
  damaged: 0,
};

const ORDER_TILES = [
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

const WMS_TILES = [
  { key: "total_skus", label: "Total SKUs" },
  { key: "units_dispatched", label: "Units Dispatched" },
  { key: "units_restocked", label: "Units Restocked", tone: "green" },
  { key: "manual_adjustments", label: "Manual Adjustments" },
  { key: "low_count", label: "Low Stock", tone: "amber" },
  { key: "negative_count", label: "Negative Stock", tone: "red" },
];

const RETURN_TILES = [
  { key: "total_returns", label: "Total Returns" },
  { key: "return_in_progress", label: "Return in Progress", tone: "amber" },
  { key: "awaiting_scan", label: "Awaiting Scan", tone: "amber" },
  { key: "received", label: "Received", tone: "green" },
  { key: "damaged", label: "Damaged", tone: "red" },
];

function Tile({ label, value, tone }) {
  const tones = {
    green: "text-emerald-600",
    red: "text-red-600",
    amber: "text-amber-600",
    muted: "text-slate-400",
  };
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone] || "text-slate-900"}`}>{value}</p>
    </div>
  );
}

// Each section owns its own date range, so Orders/WMS/Returns can be
// filtered to different periods independently instead of one range
// applying to all three.
function Section({
  title,
  hint,
  loading,
  tiles,
  summary,
  tileCount,
  error,
  dateFrom,
  dateTo,
  onApplyDateRange,
  onClearDateRange,
  downloading,
  onDownloadCsv,
}) {
  return (
    <section className="mt-8 first:mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onApplyDateRange={onApplyDateRange}
            onClearDateRange={onClearDateRange}
          />
          <Button onClick={onDownloadCsv} loading={downloading} variant="secondary">
            Download CSV
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {loading
          ? Array.from({ length: tileCount }).map((_, i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-lg border border-surface-border bg-surface" />
            ))
          : tiles.map((t) => <Tile key={t.key} label={t.label} value={summary[t.key] ?? 0} tone={t.tone} />)}
      </div>
    </section>
  );
}

// Shared shape for all three sections: own date range, own fetch, own
// "not available to this user" (403) handling, own CSV download. Only the
// data source and empty/tile config differ per section.
function useReportSection({ fetchSummary, downloadCsv, emptyValue }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [summary, setSummary] = useState(emptyValue);
  const [loading, setLoading] = useState(true);
  // 403s (user's role lacks this section's module - see moduleNav.js,
  // /reports itself only requires "oms" OR "wms") hide the section rather
  // than showing an error for something the user was never meant to see.
  const [available, setAvailable] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSummary({ dateFrom, dateTo });
      setSummary(data);
      setAvailable(true);
    } catch (err) {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  async function onDownloadCsv() {
    setDownloading(true);
    setError("");
    try {
      await downloadCsv({ dateFrom, dateTo });
    } catch (err) {
      setError(err.message || "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return {
    dateFrom,
    dateTo,
    onApplyDateRange: (from, to) => {
      setDateFrom(from);
      setDateTo(to);
    },
    onClearDateRange: () => {
      setDateFrom("");
      setDateTo("");
    },
    summary,
    loading,
    available,
    downloading,
    error,
    onDownloadCsv,
  };
}

export default function ReportsPage() {
  const orders = useReportSection({
    fetchSummary: (range) => reportsService.getSummary(range),
    downloadCsv: (range) => reportsService.downloadCsv(range),
    emptyValue: EMPTY_ORDERS,
  });
  const wms = useReportSection({
    fetchSummary: ({ dateFrom, dateTo }) =>
      wmsService.stockSummary({ date_from: dateFrom, date_to: dateTo }),
    downloadCsv: (range) => wmsService.downloadStockReportCsv(range),
    emptyValue: EMPTY_WMS,
  });
  const returns = useReportSection({
    fetchSummary: ({ dateFrom, dateTo }) =>
      ordersService.returnsSummary({ date_from: dateFrom, date_to: dateTo }),
    downloadCsv: (range) => ordersService.downloadReturnsCsv(range),
    emptyValue: EMPTY_RETURNS,
  });

  return (
    <div>
      <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Report</h1>
      <p className="mt-1 text-sm text-slate-500">
        Orders, warehouse stock and returns - each filterable to its own date range.
      </p>

      {orders.loading || orders.available ? (
        <Section title="Orders" hint="Order totals by status." tiles={ORDER_TILES} tileCount={9} {...orders} />
      ) : null}

      {wms.loading || wms.available ? (
        <Section
          title="Warehouse (WMS)"
          hint="Stock movement in range, plus the current on-hand alerts."
          tiles={WMS_TILES}
          tileCount={6}
          {...wms}
        />
      ) : null}

      {returns.loading || returns.available ? (
        <Section
          title="Returns Desk"
          hint="Courier-reported returns in range and how far each has been processed."
          tiles={RETURN_TILES}
          tileCount={5}
          {...returns}
        />
      ) : null}
    </div>
  );
}
