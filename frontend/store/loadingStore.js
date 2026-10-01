import { create } from "zustand";

// Global switch for LoadingOverlay's corner progress pill - a page-level
// component (order actions, CSV import, Shopify sync, ...) calls
// begin()/end() around a slow operation instead of each one managing its
// own indicator. The pill never blocks the screen. Reference-counted via
// `count` so two overlapping slow operations don't have the second one's
// end() hide the overlay while the first is still running.
export const useLoadingStore = create((set, get) => ({
  count: 0,
  label: "",

  begin: (label = "Loading") => {
    set({ count: get().count + 1, label });
  },

  end: () => {
    set({ count: Math.max(0, get().count - 1) });
  },
}));

export default useLoadingStore;
