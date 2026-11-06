import { create } from "zustand";
import useAuthStore, { accountKey } from "./authStore";
import { dashboardRangeForPreset } from "../lib/viewCache";

// The date filter, shared by every screen that has one (Orders, Dashboard,
// Returns, Batch, Reports, Packing): pick a range on one and the others
// open on it too, for the rest of the session. sessionStorage, so it lasts
// through a reload but not into a new tab or the next login.
const STORAGE_KEY = "oms_date_filter";

// There's no "All time": until a range is picked every screen opens on the
// last 30 days (the Dashboard's own default too).
function defaultRange() {
  const r = dashboardRangeForPreset("30");
  return { dateFrom: r.date_from, dateTo: r.date_to, chosen: false };
}

function load() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    // An empty range saved earlier was "All time" - gone now.
    if (saved && typeof saved === "object" && (saved.dateFrom || saved.dateTo)) {
      return { dateFrom: saved.dateFrom || "", dateTo: saved.dateTo || "", chosen: Boolean(saved.chosen) };
    }
  } catch {
    // storage unavailable - the filter then lasts until reload
  }
  return defaultRange();
}

function save(state) {
  try {
    if (state.chosen) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // see load()
  }
}

// Screens only render after ProtectedRoute has hydrated on the client, so
// reading storage here never diverges from a server render.
const initial = typeof window === "undefined" ? defaultRange() : load();

export const useDateFilterStore = create((set) => ({
  ...initial,
  // `chosen` tells a picked range apart from the default one.
  setRange: (dateFrom, dateTo) => {
    // Never an empty range (that was "All time") - back to the default.
    if (!dateFrom && !dateTo) {
      const next = defaultRange();
      save(next);
      set(next);
      return;
    }
    const next = { dateFrom: dateFrom || "", dateTo: dateTo || "", chosen: true };
    save(next);
    set(next);
  },
  reset: () => {
    const next = defaultRange();
    save(next);
    set(next);
  },
}));

/** The shared range with useState-style setters, for screens that kept
 * their own dateFrom/dateTo before. Each setter keeps the other end. */
export function useSessionDateRange() {
  const dateFrom = useDateFilterStore((s) => s.dateFrom);
  const dateTo = useDateFilterStore((s) => s.dateTo);
  return {
    dateFrom,
    dateTo,
    setDateFrom: (value) => {
      const { dateTo: to, setRange } = useDateFilterStore.getState();
      setRange(value, to);
    },
    setDateTo: (value) => {
      const { dateFrom: from, setRange } = useDateFilterStore.getState();
      setRange(from, value);
    },
  };
}

// Logging out, or a super admin switching stores, starts on the default range. Not
// the first load of a page (no account -> the stored one): that's the same
// session coming back after a reload.
useAuthStore.subscribe((state, prev) => {
  const before = accountKey(prev);
  if (before && accountKey(state) !== before) useDateFilterStore.getState().reset();
});

export default useDateFilterStore;
