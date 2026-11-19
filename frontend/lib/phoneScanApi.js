import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";

// A paired phone's own scan calls - the same endpoints and bodies as the
// laptop's Scan panel (lib/scanDesks.js), authorised by the phone's
// scan-session token instead of a login (backend core/scan_sessions.py), so
// the phone keeps scanning with the laptop asleep or shut.

// The session was ended (a cross pressed on any of its phones), or it's one
// made before phones could call the APIs - either way, a new QR code is needed.
export class ScanSessionEndedError extends Error {}

const SCAN_SESSION_ENDED_CODE = "scan_session_ended"; // core/middleware.py
// Longer than any scan takes; past this the phone says so instead of spinning.
const TIMEOUT_MS = 35000;

async function post(token, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${apiConfig.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Scan-Session": token,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err?.name === "AbortError"
        ? "No reply from the server. Check this parcel on the laptop before scanning it again."
        : "No internet connection. Scan this parcel again."
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && data.code === SCAN_SESSION_ENDED_CODE) {
    throw new ScanSessionEndedError(data.detail || "This scan session has ended.");
  }
  if (!response.ok) throw new Error(data.detail || "Scan failed");
  return data;
}

// One per desk in lib/scanDesks.js - each its desk's onScan, as a phone call.
export const PHONE_SCAN_CALLS = {
  pack: (token, code) => post(token, API_ENDPOINTS.oms.orderScanPack, { code }),
  packed: (token, code) => post(token, API_ENDPOINTS.wms.packingScan, { tracking_number: code }),
  dispatch: (token, code) =>
    post(token, API_ENDPOINTS.oms.orderScanDispatch, { order_number: code, tracking_number: "" }),
  returns: (token, code) => post(token, API_ENDPOINTS.wms.returnLookup, { tracking_number: code }),
};

// A return counted on the phone - the Returns desk's phoneCount.receive.
export function receiveReturn(token, orderNumber, breakdown) {
  return post(token, API_ENDPOINTS.wms.returnScan, { order_number: orderNumber, breakdown, note: "" });
}
