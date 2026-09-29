// Tiny zustand store (same pattern as store/loadingStore.js) holding
// whether BarqRaftar is connected - loaded once (orders/page.jsx) and read
// by every place that needs to show/hide the BarqRaftar actions
// (OrderRowMenu.jsx, OrderItemsEditor.jsx, OrderDetailPanel.jsx) without
// threading a prop through OrdersTable/OrderDetailPanel for it. Kept
// inside this feature folder like everything else BarqRaftar - components
// outside it only ever read `connected`/`readyToBook`, never write it.
import { create } from "zustand";

export const useBarqRaftarStatusStore = create((set) => ({
  connected: false,
  readyToBook: false,
  loaded: false,

  setStatus: ({ connected, ready_to_book }) =>
    set({ connected: Boolean(connected), readyToBook: Boolean(ready_to_book), loaded: true }),
}));

export default useBarqRaftarStatusStore;
