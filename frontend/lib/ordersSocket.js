import apiConfig from "../config/apiConfig";
import useAuthStore from "../store/authStore";

// Same access token used for every REST call (see authService.getAuthHeaders)
// - passed as a query param because a WebSocket handshake can't carry a
// custom Authorization header the way fetch() can.
function buildSocketUrl() {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  const wsBase = apiConfig.baseUrl.replace(/^http/, "ws");
  return `${wsBase}/ws/orders/?token=${encodeURIComponent(token)}`;
}

// The backend drops its Redis cache and pushes to every open tab in the
// same instant (backend: core/realtime.py), so calling onUpdate() the
// moment a frame lands makes every tab refetch simultaneously - all of
// them miss the cache and each opens its own Postgres connection. Ten open
// tabs turn one new order into ~20 concurrent queries.
//
// A short random delay spreads the herd across a window instead of
// stacking it on one millisecond. Frames arriving while that timer is
// pending are batched, not collapsed to just the latest one - each frame
// can now carry a specific order/counts to patch (core/realtime.py), and
// dropping all but the last would silently lose every other order's
// update in the same burst. onUpdate is called once per window with the
// whole batch, so a burst of fifty still costs one call, just carrying
// fifty items instead of one.
const REFETCH_JITTER_MS = 1500;

// Opens the org-scoped orders WebSocket (backend: core/consumers.py) and
// calls `onUpdate(batch)` for every burst of pushes - a new Shopify order,
// a status change, anything core/realtime.py publishes. Returns a cleanup
// function; call it on unmount. Reconnects with growing backoff if the
// connection drops (a laptop sleeping/waking, a machine restart on deploy)
// so listening resumes on its own instead of needing a manual page refresh.
export function connectOrdersSocket(onUpdate) {
  let socket = null;
  let closedByCaller = false;
  let retryDelay = 1000;
  let pendingTimer = null;
  let batch = [];

  function scheduleUpdate(data) {
    batch.push(data);
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const flushed = batch;
      batch = [];
      onUpdate(flushed);
    }, Math.random() * REFETCH_JITTER_MS);
  }

  function open() {
    const url = buildSocketUrl();
    if (!url) return;
    socket = new WebSocket(url);

    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return; // ignore malformed frames
      }
      scheduleUpdate(data);
    };

    socket.onclose = () => {
      if (closedByCaller) return;
      setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };

    socket.onopen = () => {
      retryDelay = 1000;
    };
  }

  open();

  return () => {
    closedByCaller = true;
    if (pendingTimer) clearTimeout(pendingTimer);
    socket?.close();
  };
}
