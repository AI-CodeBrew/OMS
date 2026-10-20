"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Pagination from "../../../../components/shared/Pagination";
import activityLogsAdminService from "../../../../services/activityLogsAdminService";
import { CategoryChip } from "./_components/LogBits";
import LogDetailDrawer from "./_components/LogDetailDrawer";
import LogRow from "./_components/LogRow";
import StoreRail from "./_components/StoreRail";
import {
  ACTOR_FILTERS,
  CATEGORY_ORDER,
  groupByDay,
  presetRange,
  RANGE_PRESETS,
  rangeToParams,
} from "./_lib/logMeta";

const LIVE_REFRESH_MS = 20000;

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-surface-border bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === o.value ? "bg-brand-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Every store's activity in one place: who did what, when, and from where.
export default function AdminLogsPage() {
  const [preset, setPreset] = useState("7d");
  const [range, setRange] = useState(() => presetRange("7d"));
  const [store, setStore] = useState("");
  const [actor, setActor] = useState("");
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [live, setLive] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [logs, setLogs] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  // Everything but category and paging - the category chips and the store
  // list show every category's/store's count either way.
  const baseParams = useMemo(
    () => ({
      ...rangeToParams(range),
      organization: store,
      actor,
      outcome,
      q: appliedSearch,
    }),
    [range, store, actor, outcome, appliedSearch]
  );

  const loadLogs = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError("");
      try {
        const data = await activityLogsAdminService.list({
          ...baseParams,
          category,
          page,
          page_size: pageSize,
        });
        setLogs(data.results || []);
        setCount(data.count || 0);
      } catch (err) {
        setError(err.message || "Failed to load logs");
      } finally {
        setLoading(false);
      }
    },
    [baseParams, category, page, pageSize]
  );

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      setSummary(await activityLogsAdminService.summary(baseParams));
    } catch {
      // The timeline's own error says enough.
    } finally {
      setSummaryLoading(false);
    }
  }, [baseParams]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => {
      loadLogs(true);
      loadSummary();
    }, LIVE_REFRESH_MS);
    return () => clearInterval(t);
  }, [live, loadLogs, loadSummary]);

  function changeFilter(setter) {
    return (value) => {
      setPage(1);
      setter(value);
    };
  }

  function pickPreset(value) {
    setPreset(value);
    if (value !== "custom") {
      setPage(1);
      setRange(presetRange(value));
    }
  }

  const storeName = useMemo(() => {
    if (!store) return "All stores";
    if (store === "platform") return "FynkTech panel";
    return summary?.stores?.find((s) => s.organization_id === store)?.name || "Store";
  }, [store, summary]);

  const groups = useMemo(() => groupByDay(logs), [logs]);
  const totalEvents = useMemo(
    () =>
      (summary?.stores || []).reduce((n, s) => n + s.events, 0) + (summary?.platform_events || 0),
    [summary]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Logs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything that happens in every store: who did it, when, and from where.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={RANGE_PRESETS} value={preset} onChange={pickPreset} />
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              live
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-surface-border bg-white text-slate-600 hover:text-slate-900"
            }`}
            title="Refresh the logs every 20 seconds"
          >
            <span className="relative flex h-2 w-2">
              {live ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              ) : null}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-slate-300"}`} />
            </span>
            Live
          </button>
        </div>
      </div>

      {preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-surface-border bg-white p-3 shadow-sm">
          {["from", "to"].map((key) => (
            <label key={key} className="text-xs">
              <span className="mb-1 block font-medium capitalize text-slate-600">{key}</span>
              <input
                type="date"
                value={range[key]}
                onChange={(e) => {
                  setPage(1);
                  setRange((r) => ({ ...r, [key]: e.target.value }));
                }}
                className="rounded-lg border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
              />
            </label>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <StoreRail
          stores={summary?.stores || []}
          platformEvents={summary?.platform_events || 0}
          totalEvents={totalEvents}
          selected={store}
          loading={summaryLoading}
          onSelect={changeFilter(setStore)}
        />

        <div className="min-w-0 space-y-4">
          <div className="space-y-3 rounded-xl border border-surface-border bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setPage(1);
                  setAppliedSearch(search.trim());
                }}
                className="relative min-w-[200px] flex-1"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onBlur={() => {
                    if (search.trim() !== appliedSearch) {
                      setPage(1);
                      setAppliedSearch(search.trim());
                    }
                  }}
                  placeholder="Search order #, email, IP, action…"
                  className="w-full rounded-lg border border-surface-border py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500"
                />
              </form>
              <Segmented options={ACTOR_FILTERS} value={actor} onChange={changeFilter(setActor)} />
              <select
                value={outcome}
                onChange={(e) => changeFilter(setOutcome)(e.target.value)}
                className="rounded-lg border border-surface-border px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-brand-500"
              >
                <option value="">All results</option>
                <option value="ok">Succeeded</option>
                <option value="failed">Failed only</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => changeFilter(setCategory)("")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
                  !category
                    ? "bg-brand-900 text-white ring-brand-900"
                    : "bg-white text-slate-600 ring-surface-border hover:text-slate-900"
                }`}
              >
                All activity
              </button>
              {CATEGORY_ORDER.filter((c) => summary?.categories?.[c] || category === c).map((c) => (
                <CategoryChip
                  key={c}
                  category={c}
                  count={summary?.categories?.[c] || 0}
                  active={category === c}
                  onClick={() => changeFilter(setCategory)(category === c ? "" : c)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-900">{storeName}</p>
            <p className="text-xs text-slate-500">
              {count} event{count === 1 ? "" : "s"}, newest first
            </p>
          </div>

          {error ? <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
            {loading ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex animate-pulse items-center gap-3">
                    <div className="h-3 w-10 rounded bg-slate-100" />
                    <div className="h-9 w-9 rounded-full bg-slate-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 rounded bg-slate-100" />
                      <div className="h-2.5 w-1/3 rounded bg-slate-50" />
                    </div>
                  </div>
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <p className="text-sm font-medium text-slate-700">No activity matches these filters</p>
                <p className="mt-1 text-xs text-slate-500">Try a wider date range or clear a filter.</p>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.key}>
                  <h2 className="sticky top-0 z-10 border-b border-surface-border bg-slate-50/95 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur">
                    {group.label}
                  </h2>
                  <ul className="divide-y divide-surface-border">
                    {group.items.map((log) => (
                      <LogRow
                        key={log.id}
                        log={log}
                        showStore={!store}
                        selected={selected?.id === log.id}
                        onSelect={setSelected}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
            {count > 0 ? (
              <div className="border-t border-surface-border px-4 py-3">
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  count={count}
                  onPageChange={setPage}
                  onPageSizeChange={(n) => {
                    setPage(1);
                    setPageSize(n);
                  }}
                  maxPageSize={500}
                  itemLabel="events"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <LogDetailDrawer log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
