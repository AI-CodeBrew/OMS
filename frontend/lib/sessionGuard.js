import apiConfig from "../config/apiConfig";
import authService, { SESSION_EXPIRED_MESSAGE, setLoginNotice } from "../services/authService";
import useAuthStore from "../store/authStore";
import { getSupabaseBrowserClient } from "./supabaseClient";

// What the backend says when the JWT is missing, expired or invalid: the
// tenant middleware treats such a caller as anonymous and DRF answers 403
// (not 401 - SupabaseJWTAuthentication defines no authenticate_header) with
// this exact detail. Other 403s (suspended org, no permission) differ.
const NOT_AUTHENTICATED_DETAIL = "Authentication credentials were not provided.";

let installed = false;
let refreshing = null;
let expiring = false;

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

// Signs the user out and sends them to the right login page with the reason.
async function expireSession() {
  if (expiring) return;
  expiring = true;
  const wasSuperAdmin = useAuthStore.getState().user?.role === "super_admin";
  // Before clearing the session - ProtectedRoute redirects the moment it clears.
  setLoginNotice(SESSION_EXPIRED_MESSAGE);
  try {
    await authService.logout();
  } catch {
    useAuthStore.getState().clearSession();
  }
  window.location.replace(wasSuperAdmin ? "/superadmin" : "/login");
}

// Wraps window.fetch once so every API call in the app gets the same
// treatment, instead of each service handling an expired session itself:
// on "not authenticated" it silently refreshes the token and retries once;
// if the session can't be renewed, it logs out and redirects with a message.
export function installSessionGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    // Only calls that carried a token can mean "your session ended" - this
    // leaves login attempts and public endpoints alone.
    const sentToken = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)).has(
      "Authorization"
    );
    if (!sentToken || !isApiRequest(input) || expiring || !(await isNotAuthenticated(response))) {
      return response;
    }

    const token = await refreshSession();
    if (!token) {
      await expireSession();
      return response;
    }
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    try {
      const retried = await originalFetch(input, { ...init, headers });
      if (await isNotAuthenticated(retried)) await expireSession();
      return retried;
    } catch {
      // The body couldn't be sent twice - hand back the original response.
      return response;
    }
  };

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
