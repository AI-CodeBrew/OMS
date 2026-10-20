"use client";

import { useEffect, useState } from "react";
import { formatWhen, isFailed, Who } from "./logFormat";

const HISTORY_LIMIT = 200;

function orderNumberOf(log) {
  return log.metadata?.order_number || log.summary.match(/#[\w-]+/)?.[0] || "";
}

// Side panel for a clicked log. An order's log opens that order's whole
// history, oldest first, regardless of the list's date filter; anything
// else shows the one change.
export default function LogHistoryPanel({ log, fetchLogs, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isOrder = log?.entity_type === "order" && log?.entity_id;

  useEffect(() => {
    if (!log) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [log, onClose]);

  useEffect(() => {
    if (!isOrder) {
      setHistory(log ? [log] : []);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchLogs({
      organization: log.organization_id || undefined,
      entity_type: "order",
      entity_id: log.entity_id,
      order: "asc",
      page_size: HISTORY_LIMIT,
    })
      .then((data) => !cancelled && setHistory(data.results || []))
      .catch((err) => !cancelled && setError(err.message || "Failed to load history"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [log, isOrder, fetchLogs]);

  if (!log) return null;
  const body = log.metadata?.body;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/30" />
      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-surface-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">{log.organization_name}</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">
              {isOrder ? `Order ${orderNumberOf(log)} - full history` : "Change details"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-surface hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading history…</p> : null}
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          {!loading && !error ? (
            <ol className="relative space-y-4 border-l border-surface-border pl-5">
              {history.map((entry) => {
                const when = formatWhen(entry.created_at);
                const current = entry.id === log.id;
                return (
                  <li key={entry.id} className="relative">
                    <span
                      className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${
                        isFailed(entry) ? "bg-red-500" : current ? "bg-brand-500" : "bg-slate-300"
                      }`}
                    />
                    <div className={current ? "rounded-lg bg-brand-50 px-3 py-2 -mx-3 -my-2" : ""}>
                      <p className="text-xs text-slate-500">
                        {when.date} · {when.time}
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-slate-900">
                        {entry.summary}
                        {isFailed(entry) ? (
                          <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                            Failed
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs">
                        <span className="text-slate-500">by </span>
                        <Who log={entry} />
                      </p>
                      {entry.metadata?.errors?.length ? (
                        <p className="mt-1 text-xs text-red-700">{entry.metadata.errors.join(" · ")}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {isOrder && history.length >= HISTORY_LIMIT ? (
            <p className="mt-4 text-xs text-slate-500">Showing the first {HISTORY_LIMIT} changes.</p>
          ) : null}

          {!isOrder && body && !body._upload ? (
            <div className="mt-5">
              <p className="mb-1 text-xs font-medium text-slate-500">Values sent</p>
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                {JSON.stringify(body, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
