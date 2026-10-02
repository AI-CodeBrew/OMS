import { getSupabaseBrowserClient } from "../lib/supabaseClient";
import useAuthStore from "../store/authStore";
import useTenantStore from "../store/tenantStore";

// Mirrors backend core/middleware.py: every API call from a user whose
// organization is suspended (or removed) fails with this code and message.
export const ORG_SUSPENDED_CODE = "organization_suspended";
export const ORG_SUSPENDED_MESSAGE =
  "Your organization's account has been suspended. Please contact the FynkTech team.";

// A message for the login page to show after a forced sign-out. Kept in
// sessionStorage rather than the URL because ProtectedRoute also redirects
// to /login the moment the session clears, and either redirect may land.
const LOGIN_NOTICE_KEY = "oms_login_notice";

export function setLoginNotice(message) {
  try {
    window.sessionStorage.setItem(LOGIN_NOTICE_KEY, message);
  } catch {
    // Storage unavailable - the user just won't see why.
  }
}

export function takeLoginNotice() {
  try {
    const message = window.sessionStorage.getItem(LOGIN_NOTICE_KEY);
    window.sessionStorage.removeItem(LOGIN_NOTICE_KEY);
    return message;
  } catch {
    return null;
  }
}

export function buildUser(session) {
  if (!session?.user) return null;
  const appMeta = session.user.app_metadata || {};
  const role = appMeta.role || "org_user";
  const modules = Array.isArray(appMeta.modules)
    ? appMeta.modules.filter(Boolean).map(String)
    : [];
  return {
    id: session.user.id,
    email: session.user.email,
    role,
    organization_id: appMeta.organization_id || null,
    organization_name: appMeta.organization_name || null,
    is_manual_store: Boolean(appMeta.is_manual_store),
    modules,
    isOrgAdmin: role === "org_admin",
  };
}

class AuthService {
  getAuthHeaders() {
    const { accessToken: token, user, actingStore } = useAuthStore.getState();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (user?.role === "super_admin" && actingStore?.hub) {
      headers["X-Dispatch-Hub"] = "1";
    } else if (user?.role === "super_admin" && actingStore?.id) {
      headers["X-Act-As-Organization"] = actingStore.id;
    }
    return headers;
  }

  // Signs in against Supabase Auth directly from the browser - Django never
  // proxies login, it only verifies the JWT Supabase already issued.
  async login(email, password) {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    const user = buildUser(data.session);
    useAuthStore.getState().setSession({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user,
    });
    useTenantStore.getState().syncFromAuth();

    return { user };
  }

  // Rehydrates the store from Supabase's own session on page load, in case
  // localStorage was cleared but Supabase's client still has a valid
  // refresh token cached.
  async restoreSession() {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) return null;

    const user = buildUser(data.session);
    useAuthStore.getState().setSession({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user,
    });
    useTenantStore.getState().syncFromAuth();
    return user;
  }

  async logout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    useAuthStore.getState().clearSession();
    useTenantStore.getState().clear();
  }
}

export const authService = new AuthService();
export default authService;
