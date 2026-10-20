"use client";

import { clockTime, isFailed, parseUserAgent } from "../_lib/logMeta";
import { Avatar, CategoryDot, FailedBadge, RoleBadge } from "./LogBits";

// One event on the timeline. `showStore` is off when the list is already
// one store's - the chip would just repeat the heading.
export default function LogRow({ log, showStore, selected, onSelect }) {
  const device = parseUserAgent(log.user_agent);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(log)}
        className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition ${
          selected ? "bg-brand-50" : "hover:bg-surface"
        }`}
      >
        <span className="w-12 shrink-0 pt-2 text-right font-mono text-xs tabular-nums text-slate-400">
          {clockTime(log.created_at)}
        </span>
        <CategoryDot category={log.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-900">{log.summary}</p>
            {isFailed(log) ? <FailedBadge /> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Avatar email={log.actor_email} role={log.actor_role} size="h-5 w-5 text-[9px]" />
              <span className="max-w-[200px] truncate text-slate-700">
                {log.actor_email || (log.actor_role === "system" ? "System" : "Unknown")}
              </span>
              <RoleBadge role={log.actor_role} />
            </span>
            {showStore ? (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                {log.organization_name}
              </span>
            ) : null}
            {device ? <span>{device.label}</span> : null}
            {log.ip_address ? <span className="font-mono">{log.ip_address}</span> : null}
          </div>
        </div>
        <svg
          viewBox="0 0 24 24"
          className="mt-2.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </li>
  );
}
