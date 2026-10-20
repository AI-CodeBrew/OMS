// Display metadata for the Logs tab - categories and roles match
// backend/core/activity_log_service.py and OrganizationAuditLog.ROLE_*.

// Icons are 24x24 stroke paths (rendered by LogIcon).
export const CATEGORIES = {
  orders: {
    label: "Orders",
    tone: "bg-blue-50 text-blue-700 ring-blue-200",
    icon: "M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10",
  },
  wms: {
    label: "Warehouse",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
    icon: "M3 21V9l9-6 9 6v12M7 21v-8h10v8M7 17h10",
  },
  integrations: {
    label: "Integrations",
    tone: "bg-violet-50 text-violet-700 ring-violet-200",
    icon: "M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0V7zM12 16v5",
  },
  team: {
    label: "Team",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  },
  finance: {
    label: "Finance",
    tone: "bg-teal-50 text-teal-700 ring-teal-200",
    icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  },
  support: {
    label: "Support",
    tone: "bg-rose-50 text-rose-700 ring-rose-200",
    icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  },
  store: {
    label: "Store",
    tone: "bg-sky-50 text-sky-700 ring-sky-200",
    icon: "M3 9l1.5-5h15L21 9M3 9h18M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M5 12v9h14v-9",
  },
  other: {
    label: "Other",
    tone: "bg-slate-100 text-slate-600 ring-slate-200",
    icon: "M12 8v4l3 3M12 21a9 9 0 100-18 9 9 0 000 18z",
  },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES);

export function categoryMeta(key) {
  return CATEGORIES[key] || CATEGORIES.other;
}

export const ROLES = {
  super_admin: { label: "FynkTech", tone: "bg-brand-900 text-white" },
  store_admin: { label: "Store admin", tone: "bg-slate-800 text-white" },
  store_user: { label: "Store user", tone: "bg-slate-100 text-slate-700" },
  system: { label: "System", tone: "bg-slate-100 text-slate-500" },
};

export const ACTOR_FILTERS = [
  { value: "", label: "Everyone" },
  { value: "store", label: "Store team" },
  { value: "super_admin", label: "FynkTech" },
  { value: "system", label: "System" },
];

export const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "custom", label: "Custom" },
];

function isoDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// {from, to} as local calendar dates - the backend reads a bare date as
// that whole day.
export function presetRange(preset) {
  const today = new Date();
  const days = { today: 0, "7d": 6, "30d": 29, "90d": 89 }[preset] ?? 6;
  const from = new Date(today);
  from.setDate(today.getDate() - days);
  return { from: isoDate(from), to: isoDate(today) };
}

// The browser's own day boundaries, as ISO instants - so "today" means the
// viewer's today, not the server's.
export function rangeToParams({ from, to }) {
  return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
}

export function parseUserAgent(ua) {
  if (!ua) return null;
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  else if (/python|curl|axios|node|okhttp|PostmanRuntime/i.test(ua)) browser = "API client";

  let os = "";
  if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  const mobile = /Mobile|Android|iPhone/.test(ua);
  return { browser, os, mobile, label: os ? `${browser} · ${os}` : browser };
}

export function initials(email) {
  if (!email) return "·";
  const name = email.split("@")[0].replace(/[^a-zA-Z0-9]+/g, " ").trim();
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || "·").toUpperCase();
}

export function dayKey(iso) {
  return isoDate(new Date(iso));
}

export function dayLabel(key) {
  const today = isoDate(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return "Today";
  if (key === isoDate(y)) return "Yesterday";
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function clockTime(iso, withSeconds = false) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

export function isFailed(log) {
  return log.status_code != null && log.status_code >= 400;
}

// Groups an already-sorted list into [{key, label, items}] by local day.
export function groupByDay(logs) {
  const groups = [];
  for (const log of logs) {
    const key = dayKey(log.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(log);
    else groups.push({ key, label: dayLabel(key), items: [log] });
  }
  return groups;
}
