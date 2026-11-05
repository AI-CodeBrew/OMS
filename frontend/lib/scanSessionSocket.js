import apiConfig from "../config/apiConfig";

// A connection has to survive this long before the retry delay starts over -
// otherwise one that opens and immediately drops retries at full speed forever.
const STABLE_AFTER_MS = 10000;

// The socket between a laptop's Scan panel and its paired phone (backend:
// core/consumers.py ScanSessionConsumer). Reconnects with growing backoff, so
// a phone waking up or a brief network drop picks up where it left off.
//
// handlers: onOpen(), onFrame(frame), onDown() when the connection is lost
// and being retried, onRejected() when the token is bad or expired and
// retrying can't help.
export function connectScanSession(initialToken, { onOpen, onFrame, onDown, onRejected }) {
  const wsBase = apiConfig.baseUrl.replace(/^http/, "ws");
  let token = initialToken;
  let socket = null;
  let closedByCaller = false;
  let retryTimer = null;
  let retryDelay = 1000;
  let openedAt = 0;

  function open() {
    socket = new WebSocket(`${wsBase}/ws/scan-session/?token=${encodeURIComponent(token)}`);

    socket.onopen = () => {
      openedAt = Date.now();
      onOpen?.();
    };

    socket.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return; // ignore malformed frames
      }
      onFrame?.(frame);
    };

    socket.onclose = (event) => {
      if (closedByCaller) return;
      if (event.code === 4401) {
        onRejected?.();
        return;
      }
      if (openedAt && Date.now() - openedAt >= STABLE_AFTER_MS) retryDelay = 1000;
      openedAt = 0;
      onDown?.();
      retryTimer = setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };
  }

  open();

  return {
    // False if the socket isn't open right now - the caller decides what
    // that means for its frame.
    send(frame) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(frame));
      return true;
    },
    // Which token the next reconnect uses.
    setToken(next) {
      token = next;
    },
    close() {
      closedByCaller = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    },
  };
}
