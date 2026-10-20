"use client";

import { useEffect } from "react";
import { timeAgo } from "../../../../../lib/timeAgo";
import { categoryMeta, isFailed, parseUserAgent } from "../_lib/logMeta";
import { Avatar, CategoryDot, FailedBadge, RoleBadge } from "./LogBits";

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      <dl className="divide-y divide-surface-border rounded-lg border border-surface-border bg-white">
        {children}
      </dl>
    </section>
  );
}

function Field({ label, children, mono }) {
  if (children == null || children === "") return null;
  return (
    <div className="flex gap-3 px-3 py-2 text-sm">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className={`min-w-0 flex-1 break-words text-slate-800 ${mono ? "font-mono text-xs leading-5" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

// Right-hand slide-over with everything recorded about one event.
export default function LogDetailDrawer({ log, onClose }) {
  useEffect(() => {
    if (!log) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [log, onClose]);

  if (!log) return null;
  const device = parseUserAgent(log.user_agent);
  const metadata = log.metadata || {};
  const { body, ...rest } = metadata;
  const created = new Date(log.created_at);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/30" />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
        <header className="flex items-start gap-3 border-b border-surface-border bg-white px-5 py-4">
          <CategoryDot category={log.category} size="h-10 w-10" iconSize="h-5 w-5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500">
              {categoryMeta(log.category).label} · {log.organization_name}
            </p>
            <h2 className="mt-0.5 text-base font-semibold leading-snug text-slate-900">{log.summary}</h2>
            {isFailed(log) ? (
              <div className="mt-2">
                <FailedBadge />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-surface hover:text-slate-700"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Section title="Who">
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar email={log.actor_email} role={log.actor_role} size="h-9 w-9 text-xs" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {log.actor_email || (log.actor_role === "system" ? "System (webhook / background job)" : "Unknown")}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  <RoleBadge role={log.actor_role} />
                  {log.actor_role === "super_admin" && log.organization_id ? (
                    <span className="text-xs text-slate-500">acting in this store</span>
                  ) : null}
                </div>
              </div>
            </div>
            <Field label="User ID" mono>
              {log.actor_user_id}
            </Field>
          </Section>

          <Section title="When">
            <Field label="Date">
              {created.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </Field>
            <Field label="Time">
              {created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              <span className="ml-2 text-slate-400">({timeAgo(created)})</span>
            </Field>
          </Section>

          <Section title="From where">
            <Field label="IP address" mono>
              {log.ip_address || "—"}
            </Field>
            <Field label="Device">
              {device ? `${device.label}${device.mobile ? " · mobile" : ""}` : "—"}
            </Field>
            <Field label="User agent" mono>
              {log.user_agent}
            </Field>
          </Section>

          <Section title="What">
            <Field label="Store">{log.organization_name}</Field>
            <Field label="Action" mono>
              {log.action}
            </Field>
            <Field label="Target">
              {log.entity_type ? (
                <>
                  {log.entity_type.replace(/_/g, " ")}{" "}
                  <span className="font-mono text-xs text-slate-500">{log.entity_id}</span>
                </>
              ) : null}
            </Field>
            <Field label="Request" mono>
              {log.request_method ? `${log.request_method} ${log.request_path}` : null}
            </Field>
            <Field label="Result">
              {log.status_code != null ? (
                <span className={isFailed(log) ? "font-medium text-red-700" : "text-emerald-700"}>
                  HTTP {log.status_code} {isFailed(log) ? "· failed" : "· ok"}
                </span>
              ) : null}
            </Field>
          </Section>

          {body !== undefined && body !== null ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Sent with the request
              </h3>
              {body._upload ? (
                <p className="rounded-lg border border-surface-border bg-white px-3 py-2 text-sm text-slate-600">
                  A file upload - its contents aren&apos;t stored.
                </p>
              ) : (
                <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-5 text-slate-100">
                  {JSON.stringify(body, null, 2)}
                </pre>
              )}
              <p className="text-[11px] text-slate-400">Passwords, tokens and keys are hidden.</p>
            </section>
          ) : null}

          {Object.keys(rest).length ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Details</h3>
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-5 text-slate-100">
                {JSON.stringify(rest, null, 2)}
              </pre>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
