"use client";

import { useCallback, useEffect, useState } from "react";
import printBatchService from "../../../services/printBatchService";
import Pagination from "../../../components/shared/Pagination";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";

const KIND_LABELS = { loadsheet: "Load Sheet", airway_bill: "Airway Bill" };
const KIND_FILTERS = [
  { value: "", label: "All Types" },
  { value: "loadsheet", label: "Load Sheet" },
  { value: "airway_bill", label: "Airway Bill" },
];

export default function BatchPage() {
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
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Batch</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every load sheet and airway bill ever generated - re-download exactly what was
            printed, no need to regenerate from Smartlane.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form onSubmit={onSearchSubmit} className="flex items-center gap-1.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number…"
            className="w-56 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
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
                  <td className="px-3 py-2 text-slate-500">{new Date(b.created_at).toLocaleString()}</td>
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
    </div>
  );
}
