// Tiny zustand store holding whether PostEx is connected - loaded once
// (orders/page.jsx) and read by every place that shows/hides the PostEx
// actions (OrderRowMenu, OrderItemsEditor, OrderDetailPanel). Same pattern as
// barq-raftar/_lib/barqraftarStatusStore.js; components outside this folder
// only ever read it.
import { create } from "zustand";

export const usePostExStatusStore = create((set) => ({
  connected: false,
  readyToBook: false,
  loaded: false,

  setStatus: ({ connected, ready_to_book }) =>
    set({ connected: Boolean(connected), readyToBook: Boolean(ready_to_book), loaded: true }),
}));

export default usePostExStatusStore;
