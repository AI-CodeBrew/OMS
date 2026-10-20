"use client";

// Shared by the Logs table and its history panel.

export function formatWhen(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

export function Who({ log }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="break-all text-slate-800">{log.actor}</span>
      {log.actor_role === "super_admin" ? (
        <span className="rounded bg-brand-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
          FynkTech
        </span>
      ) : null}
    </span>
  );
}

export function isFailed(log) {
  return log.status_code != null && log.status_code >= 400;
}
