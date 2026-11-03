// Tiny zustand store holding whether Leopards is connected - loaded once
// (orders/page.jsx) and read by every place that shows/hides the Leopards
// actions (OrderRowMenu, OrderItemsEditor, OrderDetailPanel). Same pattern as
// postex/_lib/postexStatusStore.js; components outside this folder only ever
// read it.
import { create } from "zustand";

export const useLeopardsStatusStore = create((set) => ({
  connected: false,
  readyToBook: false,
  // Leopards through OMS Courier - FynkTech's account, under the store's own
  // approved shipper on it.
  omsConnected: false,
  loaded: false,

  setStatus: ({ connected, ready_to_book, oms_connected }) =>
    set({
      connected: Boolean(connected),
      readyToBook: Boolean(ready_to_book),
      omsConnected: Boolean(oms_connected),
      loaded: true,
    }),
}));

export default useLeopardsStatusStore;
