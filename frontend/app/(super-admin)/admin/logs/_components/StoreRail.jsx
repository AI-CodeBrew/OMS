"use client";

import { useMemo, useState } from "react";
import { timeAgo } from "../../../../../lib/timeAgo";

function RailItem({ active, onClick, title, subtitle, count, max, muted }) {
  const share = max ? Math.max(count ? 4 : 0, Math.round((count / max) * 100)) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-lg px-3 py-2 text-left transition ${
          active ? "bg-brand-900 text-white" : "hover:bg-surface"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-sm font-medium ${
              active ? "text-white" : muted ? "text-slate-400" : "text-slate-800"
            }`}
          >
            {title}
          </span>
          <span className={`shrink-0 text-xs tabular-nums ${active ? "text-brand-100" : "text-slate-500"}`}>
            {count}
          </span>
        </div>
        {max != null ? (
          <div className={`mt-1.5 h-1 rounded-full ${active ? "bg-white/20" : "bg-slate-100"}`}>
            <div
              className={`h-1 rounded-full ${active ? "bg-white" : "bg-brand-500"}`}
              style={{ width: `${share}%` }}
            />
          </div>
        ) : null}
        {subtitle ? (
          <p className={`mt-1 truncate text-[11px] ${active ? "text-brand-100" : "text-slate-400"}`}>{subtitle}</p>
        ) : null}
      </button>
    </li>
  );
}

// Left column: every store with its event count for the current range -
// pick one to scope the timeline to it.
export default function StoreRail({ stores, platformEvents, totalEvents, selected, onSelect, loading }) {
  const [filter, setFilter] = useState("");
  const max = useMemo(() => Math.max(0, ...stores.map((s) => s.events)), [stores]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? stores.filter((s) => s.name.toLowerCase().includes(q)) : stores;
  }, [stores, filter]);

  return (
    <div className="flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm lg:sticky lg:top-4">
      <div className="border-b border-surface-border p-3">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Stores</p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a store…"
          className="w-full rounded-lg border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        <RailItem
          active={!selected}
          onClick={() => onSelect("")}
          title="All stores"
          count={totalEvents}
        />
        <RailItem
          active={selected === "platform"}
          onClick={() => onSelect("platform")}
          title="FynkTech panel"
          subtitle="Actions not tied to a store"
          count={platformEvents}
        />
        <li className="mx-2 my-1.5 border-t border-surface-border" />
        {loading && !stores.length ? (
          <li className="px-3 py-4 text-center text-xs text-slate-400">Loading…</li>
        ) : null}
        {shown.map((s) => (
          <RailItem
            key={s.organization_id}
            active={selected === s.organization_id}
            onClick={() => onSelect(s.organization_id)}
            title={s.name}
            count={s.events}
            max={max}
            muted={!s.events}
            subtitle={
              s.last_at
                ? `Last activity ${timeAgo(s.last_at)}${s.fynktech ? ` · ${s.fynktech} by FynkTech` : ""}`
                : s.is_active
                  ? "No activity in range"
                  : "Suspended"
            }
          />
        ))}
        {!loading && !shown.length && stores.length ? (
          <li className="px-3 py-4 text-center text-xs text-slate-400">No store matches.</li>
        ) : null}
      </ul>
    </div>
  );
}
