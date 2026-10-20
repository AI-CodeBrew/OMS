"use client";

import { categoryMeta, initials, ROLES } from "../_lib/logMeta";

export function LogIcon({ path, className = "h-4 w-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function CategoryDot({ category, size = "h-9 w-9", iconSize = "h-4 w-4" }) {
  const meta = categoryMeta(category);
  return (
    <span
      className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full ring-1 ${meta.tone}`}
      title={meta.label}
    >
      <LogIcon path={meta.icon} className={iconSize} />
    </span>
  );
}

export function CategoryChip({ category, count, active, onClick }) {
  const meta = categoryMeta(category);
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
        active ? "bg-brand-900 text-white ring-brand-900" : `${meta.tone} hover:brightness-95`
      }`}
    >
      <LogIcon path={meta.icon} className="h-3.5 w-3.5" />
      {meta.label}
      {count != null ? <span className="tabular-nums opacity-70">{count}</span> : null}
    </Tag>
  );
}

export function RoleBadge({ role }) {
  const meta = ROLES[role];
  if (!meta) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.tone}`}>
      {meta.label}
    </span>
  );
}

export function Avatar({ email, role, size = "h-6 w-6 text-[10px]" }) {
  const tone =
    role === "super_admin"
      ? "bg-brand-900 text-white"
      : role === "system" || !email
        ? "bg-slate-200 text-slate-500"
        : "bg-brand-100 text-brand-700";
  return (
    <span
      className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full font-semibold ${tone}`}
    >
      {role === "system" && !email ? "⚙" : initials(email)}
    </span>
  );
}

export function FailedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
      <LogIcon path="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" className="h-3 w-3" />
      Failed
    </span>
  );
}
