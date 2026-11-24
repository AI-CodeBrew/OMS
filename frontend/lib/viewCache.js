// In-memory copy of Redis-backed Orders/Dashboard payloads for the current
// browser tab. Survives client-side navigations (Dashboard <-> Orders, and
// Back) so going back is instant. Cleared when the backend WebSocket says an
// order changed; the refetch then repopulates both this map and Redis.
//
// Kept apart per view (scope = authStore.accountKey: the login, the store it
// operates, the Dispatch Hub, All Orders, ...) instead of wiped on every
// switch, so Back into the Hub or a store shows its last data at once
// (user, 2026-11-24) - the page then refreshes it quietly (see the Orders
// page's and Dashboard's load). authStore sets the scope.

const scopes = new Map();
let scope = "";
let warmupGeneration = 0;

function current() {
  let entry = scopes.get(scope);
  if (!entry) {
    entry = { lists: new Map(), counts: null, dashboards: new Map() };
    scopes.set(scope, entry);
  }
  return entry;
}

/** Which view's cache reads and writes go to - authStore calls this when
 * the login or the store/Hub it operates changes. */
export function setViewCacheScope(key) {
  scope = key || "";
}

/** The view and cache generation right now. A fetch started under one
 * token must not be stored after the view changed or the cache was
 * dropped - pass it to the setters (they ignore a stale one). */
export function viewCacheToken() {
  return `${scope}#${warmupGeneration}`;
}

function stale(token) {
  return token !== undefined && token !== viewCacheToken();
}

export function ordersListKey({ status, page, pageSize, filters = {} }) {
  // Every filter the list honours belongs here - one left out makes a
  // filtered view reuse the unfiltered page cached under the same key.
  const extras = [
    "search", "city", "courier_id", "gateway", "date_from", "date_to", "store", "product", "dispatch_requested",
    // The Filters popup's fields (OrderFieldFilters).
    "f_oms_id", "f_store_order_id", "f_customer", "f_phone", "f_tracking",
    "f_shop", "f_city", "f_province", "f_courier", "f_tag", "f_city_fix",
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
  return current().lists.get(key) || null;
}

export function setCachedOrdersList(key, value, token) {
  if (stale(token)) return;
  current().lists.set(key, value);
}

export function getCachedCounts() {
  return current().counts;
}

export function setCachedCounts(value, token) {
  if (stale(token)) return;
  current().counts = value;
}

export function getCachedDashboard(key) {
  return current().dashboards.get(key) || null;
}

export function setCachedDashboard(key, value, token) {
  if (stale(token)) return;
  current().dashboards.set(key, value);
}

// Changes with the view too, so a warmup started in one view is never
// applied to another.
export function getWarmupGeneration() {
  return viewCacheToken();
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

/** Drops every view's cached data - an order changed (it may show in the
 * Hub and in its store alike), or the user logged out. */
export function invalidateViewCache() {
  scopes.clear();
  warmupGeneration += 1;
}
