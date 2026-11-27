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
//
// An order change no longer drops any of it (user, 2026-11-27: the Hub
// loaded everything again after a visit to a store - every courier update
// there had wiped the Hub's copy too). It marks every view's data out of
// date instead: a page still shows it at once and refreshes it quietly
// (the is...Fresh checks below). Only logging out drops it (clearViewCache).

const scopes = new Map();
let scope = "";
let warmupGeneration = 0;
// Counts writes and "out of date" marks, in order: an entry is fresh while
// it was written after its view was last marked out of date.
let clock = 0;

function current() {
  let entry = scopes.get(scope);
  if (!entry) {
    entry = { lists: new Map(), counts: null, dashboards: new Map(), staleBefore: 0 };
    scopes.set(scope, entry);
  }
  return entry;
}

function stamp(value) {
  clock += 1;
  return { value, at: clock };
}

function isFresh(slot) {
  return Boolean(slot) && slot.at > current().staleBefore;
}

/** The view itself (login + store / Hub), without the generation - for a
 * page's own cache that should outlive order changes (the Inventory page). */
export function viewCacheScope() {
  return scope;
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
  return current().lists.get(key)?.value || null;
}

/** False once an order changed after this list was fetched - show it, but
 * fetch it again. */
export function isOrdersListFresh(key) {
  return isFresh(current().lists.get(key));
}

export function setCachedOrdersList(key, value, token) {
  if (stale(token)) return;
  current().lists.set(key, stamp(value));
}

export function getCachedCounts() {
  return current().counts?.value || null;
}

function countsAreFresh() {
  return isFresh(current().counts);
}

export function setCachedCounts(value, token) {
  if (stale(token)) return;
  current().counts = stamp(value);
}

export function getCachedDashboard(key) {
  return current().dashboards.get(key)?.value || null;
}

export function isDashboardFresh(key) {
  return isFresh(current().dashboards.get(key));
}

export function setCachedDashboard(key, value, token) {
  if (stale(token)) return;
  current().dashboards.set(key, stamp(value));
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

// Warm = cached and fresh: out-of-date tabs get the background warmup again.
export function unfilteredListsAreWarm(pageSize, statuses) {
  if (!countsAreFresh()) return false;
  return statuses.every((status) =>
    isOrdersListFresh(
      ordersListKey({
        status: status === "all" ? undefined : status,
        page: 1,
        pageSize,
        filters: {},
      })
    )
  );
}

export function dashboardPresetsAreWarm() {
  return dashboardPresetKeys().every((key) => isDashboardFresh(key));
}

/** An order changed (it may show in the Hub and in its store alike), or a
 * setting that changes the lists: every view's data is out of date. Kept,
 * not dropped - shown at once and refreshed quietly (see the top). A reply
 * already on its way is not stored (viewCacheToken changes). */
export function invalidateViewCache() {
  clock += 1;
  scopes.forEach((entry) => {
    entry.staleBefore = clock;
  });
  warmupGeneration += 1;
}

// Pages' own caches (the Inventory page's) - dropped with this one.
const clearListeners = new Set();

export function onViewCacheClear(fn) {
  clearListeners.add(fn);
}

/** Drops every view's data - on logout, so the next person at this
 * computer never sees it. */
export function clearViewCache() {
  scopes.clear();
  warmupGeneration += 1;
  clearListeners.forEach((fn) => fn());
}
