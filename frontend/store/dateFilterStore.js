import { create } from "zustand";
import useAuthStore, { accountKey } from "./authStore";

// The date filter, shared by every screen that has one (Orders, Dashboard,
// Returns, Batch, Reports, Packing): pick a range on one and the others
// open on it too, for the rest of the session. sessionStorage, so it lasts
// through a reload but not into a new tab or the next login.
const STORAGE_KEY = "oms_date_filter";

function load() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === "object") {
      return { dateFrom: saved.dateFrom || "", dateTo: saved.dateTo || "", chosen: Boolean(saved.chosen) };
    }
  } catch {
    // storage unavailable - the filter then lasts until reload
  }
  return { dateFrom: "", dateTo: "", chosen: false };
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
const initial = typeof window === "undefined" ? { dateFrom: "", dateTo: "", chosen: false } : load();

export const useDateFilterStore = create((set) => ({
  ...initial,
  // `chosen` tells "All time picked" apart from "nothing picked yet" - the
  // Dashboard opens on its own default (last 30 days) only for the latter.
  setRange: (dateFrom, dateTo) => {
    const next = { dateFrom: dateFrom || "", dateTo: dateTo || "", chosen: true };
    save(next);
    set(next);
  },
  reset: () => {
    const next = { dateFrom: "", dateTo: "", chosen: false };
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

// Logging out, or a super admin switching stores, starts unfiltered. Not
// the first load of a page (no account -> the stored one): that's the same
// session coming back after a reload.
useAuthStore.subscribe((state, prev) => {
  const before = accountKey(prev);
  if (before && accountKey(state) !== before) useDateFilterStore.getState().reset();
});

export default useDateFilterStore;
