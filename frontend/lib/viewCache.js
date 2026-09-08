// In-memory copy of Redis-backed Orders/Dashboard payloads for the current
// browser tab. Survives client-side navigations (Dashboard <-> Orders) so
// switching back is instant. Cleared when the backend WebSocket says an
// order changed; the refetch then repopulates both this map and Redis.

const lists = new Map();
let counts = null;
const dashboards = new Map();
let warmupGeneration = 0;

export function ordersListKey({ status, page, pageSize, filters = {} }) {
  const extras = ["search", "city", "courier_id", "gateway", "date_from", "date_to"]
    .map((k) => filters[k] || "")
    .join("|");
  return `${status || "all"}|${page}|${pageSize}|${extras}`;
}

export function dashboardKey({ date_from = "", date_to = "" }) {
  return `${date_from}|${date_to}`;
}

function toDateInputValue(d) {
  return d.toISOString().slice(0, 10);
}

export function dashboardRangeFor(days) {
  const to = new Date();
  const from = new Date();
  if (days !== null) from.setDate(to.getDate() - (days - 1));
  return { date_from: days === null ? "" : toDateInputValue(from), date_to: toDateInputValue(to) };
}

export function dashboardPresetKeys() {
  return [7, 30, 90, null].map((days) => dashboardKey(dashboardRangeFor(days)));
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
