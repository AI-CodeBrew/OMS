import { create } from "zustand";
import financeService from "../services/financeService";

// Shared across every place that needs to know/gate on "has this store
// saved its bank details yet" - fetched at most once per session instead
// of once per component (Integrations cards, Settings > Stores, …).
const useBankDetailsStore = create((set, get) => ({
  // undefined = not fetched yet, null = fetched and empty, object = saved.
  details: undefined,
  loading: false,

  async ensureLoaded() {
    if (get().details !== undefined) return get().details;
    if (get().loading) {
      // Another caller's fetch is already in flight - wait for it instead
      // of firing a second request.
      return new Promise((resolve) => {
        const unsubscribe = useBankDetailsStore.subscribe((state) => {
          if (!state.loading) {
            unsubscribe();
            resolve(state.details ?? null);
          }
        });
      });
    }
    set({ loading: true });
    try {
      const details = await financeService.getBankDetails();
      set({ details: details || null, loading: false });
      return details || null;
    } catch {
      set({ loading: false });
      return null;
    }
  },

  setDetails(details) {
    set({ details: details || null });
  },
}));

export default useBankDetailsStore;
