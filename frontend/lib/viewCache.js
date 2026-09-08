// In-memory copy of Redis-backed Orders/Dashboard payloads for the current
// browser tab. Survives client-side navigations (Dashboard <-> Orders) so
// switching back is instant. Cleared when the backend WebSocket says an
// order changed; the refetch then repopulates both this map and Redis.

const lists = new Map();
let counts = null;
const dashboards = new Map();

export function ordersListKey({ status, page, pageSize, filters = {} }) {
  const extras = ["search", "city", "courier_id", "gateway", "date_from", "date_to"]
    .map((k) => filters[k] || "")
    .join("|");
  return `${status || "all"}|${page}|${pageSize}|${extras}`;
}

export function dashboardKey({ date_from = "", date_to = "" }) {
  return `${date_from}|${date_to}`;
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

export function invalidateViewCache() {
  lists.clear();
  counts = null;
  dashboards.clear();
}
