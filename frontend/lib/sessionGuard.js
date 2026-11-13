import apiConfig from "../config/apiConfig";
import authService, { SESSION_EXPIRED_MESSAGE, setLoginNotice } from "../services/authService";
import useAuthStore from "../store/authStore";
import { getSupabaseBrowserClient } from "./supabaseClient";
import { sessionExpiresAt } from "./sessionClock";

// What the backend says when the JWT is missing, expired or invalid: the
// tenant middleware treats such a caller as anonymous and DRF answers 403
// (not 401 - SupabaseJWTAuthentication defines no authenticate_header) with
// this exact detail. Other 403s (suspended org, no permission) differ.
const NOT_AUTHENTICATED_DETAIL = "Authentication credentials were not provided.";

// The backend's own verdict on the session (core/session_policy.py): 12
// hours since sign-in, or logged out. Never retried - signed out at once.
const SESSION_EXPIRED_CODE = "session_expired";
const SESSION_ENDED_CODE = "session_ended";
const SESSION_ENDED_MESSAGE = "You have been signed out. Please sign in again to continue.";

// The key the auth store keeps the session under (store/authStore.js) -
// shared by every tab, so a sign-out in one is seen by the others.
const AUTH_STORAGE_KEY = "oms_auth";

// Sign-out when a token merely can't be renewed is switched OFF for now
// (user request, 2026-11-04): the user stays on the page instead - API calls
// then fail until they log out and back in. Set back to true to restore it.
// The 12-hour limit and a logged-out session always sign out (endSession).
const AUTO_SIGN_OUT_ON_EXPIRY = false;

// Longest delay setTimeout accepts (~24.8 days) - a guard only.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

let installed = false;
let refreshing = null;
let expiring = false;
let expiryTimer = null;

function isApiRequest(input) {
  const url = typeof input === "string" ? input : input?.url || "";
  return url.startsWith(apiConfig.baseUrl);
}

async function isNotAuthenticated(response) {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  const data = await response.clone().json().catch(() => null);
  return data?.detail === NOT_AUTHENTICATED_DETAIL;
}

// "session_expired" / "session_ended" when the backend refused the session
// itself, else "".
async function sessionEndCode(response) {
  if (response.status !== 401) return "";
  const data = await response.clone().json().catch(() => null);
  const code = data?.code || "";
  return code === SESSION_EXPIRED_CODE || code === SESSION_ENDED_CODE ? code : "";
}

// Asks Supabase for a fresh token and puts it in the auth store. One call
// at a time - several requests failing together share the same refresh.
function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const { data, error } = await getSupabaseBrowserClient().auth.refreshSession();
        if (error || !data?.session) return null;
        const { user } = useAuthStore.getState();
        useAuthStore.getState().setSession({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          user,
        });
        return data.session.access_token;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** Signs the user out for good and sends them to their login page, with
 * `message` shown there (null: none). Runs once, however many timers, tabs
 * and failing requests ask at the same moment. */
export async function endSession(message = SESSION_EXPIRED_MESSAGE) {
  if (expiring) return;
  expiring = true;
  clearTimeout(expiryTimer);
  const wasSuperAdmin = useAuthStore.getState().user?.role === "super_admin";
  // Before clearing the session - ProtectedRoute redirects the moment it clears.
  if (message) setLoginNotice(message);
  try {
    await authService.logout();
  } catch {
    useAuthStore.getState().clearSession();
  }
  window.location.replace(wasSuperAdmin ? "/superadmin" : "/login");
}

// The token couldn't be renewed - signs out only while that's switched on.
async function expireSession() {
  if (!AUTO_SIGN_OUT_ON_EXPIRY) return;
  await endSession();
}

function endForCode(code) {
  endSession(code === SESSION_ENDED_CODE ? SESSION_ENDED_MESSAGE : SESSION_EXPIRED_MESSAGE);
}

// Sets the timer for the moment this sign-in turns 12 hours old - read from
// the token itself, so a reload, another tab or a refreshed token all land
// on the same moment. Re-run whenever the token changes or the tab wakes up
// (browsers hold timers back in hidden tabs and while the computer sleeps).
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  expiryTimer = null;
  if (expiring) return;
  const expiresAt = sessionExpiresAt(useAuthStore.getState().accessToken);
  if (expiresAt === null) return;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    endSession();
    return;
  }
  expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, MAX_TIMEOUT_MS));
}

// Wraps window.fetch once so every API call in the app gets the same
// treatment, instead of each service handling an expired session itself:
// a session the backend refuses (12 hours old, or logged out) signs out at
// once; any other "not authenticated" silently refreshes the token and
// retries once.
export function installSessionGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    // Only calls that carried a token can mean "your session ended" - this
    // leaves login attempts and public endpoints alone.
    const sentToken = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)).has(
      "Authorization"
    );
    const guarded = sentToken && isApiRequest(input);
    // Signing out: the page is about to give way to the login screen - its
    // calls are held back rather than flashing errors on the way out.
    if (guarded && expiring) return new Promise(() => {});
    const response = await originalFetch(input, init);
    if (!guarded) return response;

    const endCode = await sessionEndCode(response);
    if (endCode) {
      endForCode(endCode);
      return new Promise(() => {});
    }
    if (!(await isNotAuthenticated(response))) return response;

    const token = await refreshSession();
    if (!token) {
      await expireSession();
      return response;
    }
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    try {
      const retried = await originalFetch(input, { ...init, headers });
      const retriedCode = await sessionEndCode(retried);
      if (retriedCode) {
        endForCode(retriedCode);
        return new Promise(() => {});
      }
      if (await isNotAuthenticated(retried)) await expireSession();
      return retried;
    } catch {
      // The body couldn't be sent twice - hand back the original response.
      return response;
    }
  };

  // The 12-hour sign-out: set now, re-set whenever the token changes
  // (sign-in, refresh, store switch) and whenever the tab comes back.
  scheduleExpiry();
  useAuthStore.subscribe((state, prev) => {
    if (state.accessToken !== prev.accessToken) scheduleExpiry();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleExpiry();
  });
  window.addEventListener("focus", scheduleExpiry);

  // Signed out in another tab (by hand, or its own 12-hour sign-out): this
  // tab follows at once instead of carrying on with a dead session.
  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_STORAGE_KEY || event.newValue) return;
    if (!useAuthStore.getState().accessToken) return;
    endSession(null);
  });

  // Supabase renews the token in the background before it runs out; keep
  // the copy the API calls read in step with it.
  getSupabaseBrowserClient().auth.onAuthStateChange((event, session) => {
    if (event !== "TOKEN_REFRESHED" || !session) return;
    const { user, accessToken } = useAuthStore.getState();
    if (!accessToken || accessToken === session.access_token) return;
    useAuthStore.getState().setSession({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      user,
    });
  });
}
