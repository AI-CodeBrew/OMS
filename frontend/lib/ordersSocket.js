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

// Opens the org-scoped orders WebSocket (backend: core/consumers.py) and
// calls `onUpdate` for every push - a new Shopify order, a status change,
// anything core/realtime.py publishes. Returns a cleanup function; call it
// on unmount. Reconnects with growing backoff if the connection drops (a
// laptop sleeping/waking, a brief Render restart) so listening resumes on
// its own instead of needing a manual page refresh.
export function connectOrdersSocket(onUpdate) {
  let socket = null;
  let closedByCaller = false;
  let retryDelay = 1000;

  function open() {
    const url = buildSocketUrl();
    if (!url) return;
    socket = new WebSocket(url);

    socket.onmessage = (event) => {
      try {
        onUpdate(JSON.parse(event.data));
      } catch {
        // ignore malformed frames
      }
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
    socket?.close();
  };
}
