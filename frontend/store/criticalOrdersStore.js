import { create } from "zustand";

// How many orders are in the Critical Orders tab right now (in transit for
// more than 3 days). Written by components/orders/CriticalOrdersAlert.jsx,
// read by the header's bell for its badge.
export const useCriticalOrdersStore = create((set) => ({
  count: 0,
  setCount: (count) => set({ count: Number(count) || 0 }),
}));

export default useCriticalOrdersStore;
