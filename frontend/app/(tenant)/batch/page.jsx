"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import printBatchService from "../../../services/printBatchService";
import ordersService from "../../../services/ordersService";
import Pagination from "../../../components/shared/Pagination";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import { SMARTLANE_LOAD_SHEET_COURIERS } from "../../../components/orders/statusConfig";

const AirwayBillFilterModal = dynamic(
  () => import("../../../components/orders/AirwayBillFilterModal"),
  { ssr: false }
);

const KIND_LABELS = { loadsheet: "Load Sheet", airway_bill: "Airway Bill" };
const KIND_FILTERS = [
  { value: "", label: "All Types" },
  { value: "loadsheet", label: "Load Sheet" },
  { value: "airway_bill", label: "Airway Bill" },
];
const LOAD_SHEET_COURIERS = SMARTLANE_LOAD_SHEET_COURIERS.filter(
  (c) => !c.disabled && c.value !== "all"
);
const SECTIONS = [
  { value: "history", label: "History" },
  { value: "daily", label: "Daily Batch" },
];

// day is a plain "YYYY-MM-DD" string - constructing with a T00:00:00 local
// time (instead of new Date(day), which parses as UTC midnight) avoids the
// date shifting a day backward for anyone west of UTC.
function formatDayLabel(day) {
  const date = new Date(`${day}T00:00:00`);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfToday - date) / 86400000);
  const full = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (diffDays === 0) return { primary: "Today", secondary: full };
  if (diffDays === 1) return { primary: "Yesterday", secondary: full };
  return { primary: date.toLocaleDateString(undefined, { weekday: "long" }), secondary: full };
}

function HistorySection() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [kind, setKind] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [batches, setBatches] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await printBatchService.list({
        q: appliedSearch,
        kind,
        date_from: dateFrom,
        date_to: dateTo,
        page,
        page_size: pageSize,
      });
      setBatches(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load batches");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, kind, dateFrom, dateTo, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function onSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  async function onDownload(batch) {
    setDownloadingId(batch.id);
    setError("");
    try {
      await printBatchService.download(batch);
    } catch (err) {
      setError(err.message || "Download failed");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={onSearchSubmit}
          className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number…"
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-56"
          />
          <button
            type="submit"
            className="rounded-md border border-surface-border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface"
          >
            Search
          </button>
        </form>

        <select
          value={kind}
          onChange={(e) => {
            setPage(1);
            setKind(e.target.value);
          }}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApplyDateRange={(from, to) => {
            setPage(1);
            setDateFrom(from);
            setDateTo(to);
          }}
          onClearDateRange={() => {
            setPage(1);
            setDateFrom("");
            setDateTo("");
          }}
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-lg border border-surface-border bg-white">
        <table className="w-full text-left">
          <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Courier</th>
              <th className="px-3 py-2">Orders</th>
              <th className="px-3 py-2">Generated</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="text-sm">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : batches.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No batches yet - generate a load sheet or airway bill from the Orders page.
                </td>
              </tr>
            ) : (
              batches.map((b) => (
                <tr key={b.id} className="border-b border-surface-border last:border-0 hover:bg-surface/60">
                  <td className="px-3 py-2 font-medium text-slate-900">{KIND_LABELS[b.kind] || b.kind}</td>
                  <td className="px-3 py-2 capitalize text-slate-700">{b.courier || "—"}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {b.order_count} order{b.order_count === 1 ? "" : "s"}
                    {b.order_numbers?.length ? (
                      <div className="mt-0.5 truncate text-xs text-slate-400" title={b.order_numbers.join(", ")}>
                        {b.order_numbers.slice(0, 4).join(", ")}
                        {b.order_numbers.length > 4 ? ` +${b.order_numbers.length - 4} more` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{new Date(b.updated_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDownload(b)}
                      disabled={downloadingId === b.id}
                      className="rounded-md border border-surface-border px-2.5 py-1 text-xs font-medium text-brand-600 hover:bg-surface disabled:opacity-50"
                    >
                      {downloadingId === b.id ? "Downloading…" : "Download"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
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
      </div>
    </>
  );
}

function DailyBatchSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [airwayBillDay, setAirwayBillDay] = useState(null);
  // Per-date selected courier + in-flight state for the Load Sheet button.
  const [courierByDate, setCourierByDate] = useState({});
  const [loadSheetBusyDate, setLoadSheetBusyDate] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await printBatchService.listDaily({ date_from: dateFrom, date_to: dateTo });
      setDays(data || []);
    } catch (err) {
      setError(err.message || "Failed to load daily batches");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  async function onDownloadLoadSheet(day) {
    const courier = courierByDate[day.date];
    if (!courier) return;
    setLoadSheetBusyDate(day.date);
    setError("");
    try {
      await ordersService.printSmartlaneLoadSheet(
        day.orders.map((o) => o.id),
        courier
      );
    } catch (err) {
      setError(err.message || "Print failed");
    } finally {
      setLoadSheetBusyDate(null);
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
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
        {!dateFrom && !dateTo ? (
          <span className="text-xs text-slate-400">Showing the last 30 days</span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-lg border border-surface-border bg-white">
        <table className="w-full text-left">
          <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Orders</th>
              <th className="px-3 py-2.5">Products</th>
              <th className="px-3 py-2.5 text-right">Documents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border text-sm">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : days.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  No orders have reached Ready to Print in this range yet.
                </td>
              </tr>
            ) : (
              days.map((day) => {
                const label = formatDayLabel(day.date);
                const courier = courierByDate[day.date] || "";
                return (
                  <tr key={day.date} className="hover:bg-surface/60">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{label.primary}</div>
                      <div className="text-xs text-slate-500">{label.secondary}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-slate-900">{day.order_count}</span>{" "}
                      <span className="text-slate-500">order{day.order_count === 1 ? "" : "s"}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {day.products.length ? (
                        <span title={day.products.join(", ")}>
                          {day.products.slice(0, 3).join(", ")}
                          {day.products.length > 3 ? ` +${day.products.length - 3} more` : ""}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-nowrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAirwayBillDay(day)}
                          className="whitespace-nowrap rounded-md border border-surface-border px-2.5 py-1.5 text-xs font-medium text-brand-600 hover:bg-surface"
                        >
                          Airway Bill
                        </button>
                        <div className="flex items-center rounded-md border border-surface-border">
                          <select
                            value={courier}
                            onChange={(e) =>
                              setCourierByDate((prev) => ({ ...prev, [day.date]: e.target.value }))
                            }
                            className="rounded-l-md bg-transparent py-1.5 pl-2 pr-1 text-xs text-slate-700 outline-none"
                          >
                            <option value="">Courier…</option>
                            {LOAD_SHEET_COURIERS.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => onDownloadLoadSheet(day)}
                            disabled={!courier || loadSheetBusyDate === day.date}
                            className="whitespace-nowrap rounded-r-md border-l border-surface-border px-2.5 py-1.5 text-xs font-medium text-brand-600 hover:bg-surface disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                          >
                            {loadSheetBusyDate === day.date ? "…" : "Load Sheet"}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AirwayBillFilterModal orders={airwayBillDay?.orders} onClose={() => setAirwayBillDay(null)} />
    </>
  );
}

export default function BatchPage() {
  const [section, setSection] = useState("history");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Batch</h1>
          <p className="mt-1 text-sm text-slate-500">
            {section === "history"
              ? "Every load sheet and airway bill ever generated - re-download exactly what was printed, no need to regenerate from Smartlane."
              : "Every order that reached Ready to Print, grouped by day - (re-)generate an airway bill or load sheet for the whole day, whether or not anyone has printed one yet."}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setSection(s.value)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              section === s.value
                ? "border-brand-700 bg-brand-800 text-white"
                : "border-surface-border bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "history" ? <HistorySection /> : <DailyBatchSection />}
    </div>
  );
}
