"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LogHistoryPanel from "./LogHistoryPanel";
import { formatWhen, isFailed, Who } from "./logFormat";

const PERIODS = [
  { value: "1", label: "Last 1 day" },
  { value: "2", label: "Last 2 days" },
  { value: "7", label: "Last 7 days" },
  { value: "15", label: "Last 15 days" },
  { value: "30", label: "Last 1 month" },
];
const PAGE_SIZE = 50;

// {from, to} as ISO instants in the viewer's own day boundaries: a picked
// date is that whole local day; a period is the last N days up to now.
function rangeParams(period, date) {
  if (date) {
    return {
      from: new Date(`${date}T00:00:00`).toISOString(),
      to: new Date(`${date}T23:59:59.999`).toISOString(),
    };
  }
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (Number(period) - 1));
  return { from: from.toISOString() };
}

// The Logs table - what changed, when, and who changed it. Shared by the
// super admin's Logs tab (`stores` given: a store filter + Store column)
// and a store's own Logs page (always just that store).
// fetchLogs(params) -> {count, results}.
export default function ActivityLog({ fetchLogs, stores = null }) {
  const [period, setPeriod] = useState("7");
  const [date, setDate] = useState("");
  const [store, setStore] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(null);

  const showStore = Boolean(stores) && !store;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchLogs({
        ...rangeParams(period, date),
        organization: store || undefined,
        q: query || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setLogs(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load logs");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [fetchLogs, period, date, store, query, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const storeOptions = useMemo(
    () => (stores || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [stores]
  );

  const control =
    "rounded-lg border border-surface-border bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-500";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {stores ? (
          <label className="text-xs font-medium text-slate-600">
            Store
            <select
              value={store}
              onChange={(e) => {
                setPage(1);
                setStore(e.target.value);
              }}
              className={`${control} mt-1 block min-w-[180px]`}
            >
              <option value="">All stores</option>
              {storeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="text-xs font-medium text-slate-600">
          Period
          <select
            value={period}
            disabled={Boolean(date)}
            onChange={(e) => {
              setPage(1);
              setPeriod(e.target.value);
            }}
            className={`${control} mt-1 block disabled:opacity-50`}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-slate-600">
          Or a date
          <span className="mt-1 flex items-center gap-1">
            <input
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => {
                setPage(1);
                setDate(e.target.value);
              }}
              className={control}
            />
            {date ? (
              <button
                type="button"
                onClick={() => {
                  setPage(1);
                  setDate("");
                }}
                className="rounded-lg px-2 py-2 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-800"
              >
                Clear
              </button>
            ) : null}
          </span>
        </label>

        <form
          className="ml-auto text-xs font-medium text-slate-600"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => {
              if (search.trim() !== query) {
                setPage(1);
                setQuery(search.trim());
              }
            }}
            placeholder="Order #, email, courier…"
            className={`${control} mt-1 block w-60`}
          />
        </form>
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">When</th>
                {showStore ? <th className="px-4 py-3 font-medium">Store</th> : null}
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">What changed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    No changes in this period.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const when = formatWhen(log.created_at);
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setOpened(log)}
                      className="cursor-pointer align-top hover:bg-surface"
                      title={log.entity_type === "order" ? "Show this order's full history" : "Show details"}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="text-slate-800">{when.date}</div>
                        <div className="text-xs text-slate-500">{when.time}</div>
                      </td>
                      {showStore ? (
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{log.organization_name}</td>
                      ) : null}
                      <td className="px-4 py-3">
                        <Who log={log} />
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        {log.summary}
                        {isFailed(log) ? (
                          <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                            Failed
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {count > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-surface-border px-4 py-3 text-sm">
            <span className="text-slate-500">
              {count} changes · page {page} of {pages}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-surface-border px-3 py-1.5 text-slate-700 hover:bg-surface disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-surface-border px-3 py-1.5 text-slate-700 hover:bg-surface disabled:opacity-40"
              >
                Next
              </button>
            </span>
          </div>
        ) : null}
      </div>

      <LogHistoryPanel log={opened} fetchLogs={fetchLogs} onClose={() => setOpened(null)} />
    </div>
  );
}
