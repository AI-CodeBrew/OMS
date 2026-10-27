// In-memory copy of Redis-backed Orders/Dashboard payloads for the current
// browser tab. Survives client-side navigations (Dashboard <-> Orders) so
// switching back is instant. Cleared when the backend WebSocket says an
// order changed; the refetch then repopulates both this map and Redis.

const lists = new Map();
let counts = null;
const dashboards = new Map();
let warmupGeneration = 0;

export function ordersListKey({ status, page, pageSize, filters = {} }) {
  // Every filter the list honours belongs here - one left out makes a
  // filtered view reuse the unfiltered page cached under the same key.
  const extras = [
    "search", "city", "courier_id", "gateway", "date_from", "date_to", "store", "product", "dispatch_requested",
  ]
    .map((k) => filters[k] || "")
    .join("|");
  return `${status || "all"}|${page}|${pageSize}|${extras}`;
}

export function dashboardKey({ date_from = "", date_to = "" }) {
  return `${date_from}|${date_to}`;
}

// The local calendar day (Pakistan for the team), not toISOString's UTC
// one - that read as yesterday between midnight and 5 AM.
function toDateInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dashboardRangeFor(days) {
  const to = new Date();
  const from = new Date();
  if (days !== null) from.setDate(to.getDate() - (days - 1));
  return { date_from: days === null ? "" : toDateInputValue(from), date_to: toDateInputValue(to) };
}

// The Dashboard's range buttons (Custom aside) - each warmed in the
// background so switching between them is instant.
export const DASHBOARD_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
];

export function dashboardRangeForPreset(key) {
  if (key === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const day = toDateInputValue(d);
    return { date_from: day, date_to: day };
  }
  return dashboardRangeFor(key === "today" ? 1 : Number(key) || 7);
}

export function dashboardPresetKeys() {
  return DASHBOARD_PRESETS.map((p) => dashboardKey(dashboardRangeForPreset(p.key)));
}

export function getCachedOrdersList(key) {
  return lists.get(key) || null;
}

export function setCachedOrdersList(key, value) {
  lists.set(key, value);
}

export function getCachedCounts() {
  return counts;
}

export function setCachedCounts(value) {
  counts = value;
}

export function getCachedDashboard(key) {
  return dashboards.get(key) || null;
}

export function setCachedDashboard(key, value) {
  dashboards.set(key, value);
}

export function getWarmupGeneration() {
  return warmupGeneration;
}

export function applyWarmup(payload, pageSize) {
  if (payload?.counts) setCachedCounts(payload.counts);
  Object.entries(payload?.lists || {}).forEach(([status, list]) => {
    const key = ordersListKey({
      status: status === "all" ? undefined : status,
      page: 1,
      pageSize,
      filters: {},
    });
    setCachedOrdersList(key, { orders: list.results || [], orderCount: list.count || 0 });
  });
  Object.entries(payload?.dashboards || {}).forEach(([key, value]) => {
    setCachedDashboard(key, value);
  });
}

export function unfilteredListsAreWarm(pageSize, statuses) {
  if (!getCachedCounts()) return false;
  return statuses.every((status) =>
    Boolean(
      getCachedOrdersList(
        ordersListKey({
          status: status === "all" ? undefined : status,
          page: 1,
          pageSize,
          filters: {},
        })
      )
    )
  );
}

export function dashboardPresetsAreWarm() {
  return dashboardPresetKeys().every((key) => Boolean(getCachedDashboard(key)));
}

export function invalidateViewCache() {
  lists.clear();
  counts = null;
  dashboards.clear();
  warmupGeneration += 1;
}
