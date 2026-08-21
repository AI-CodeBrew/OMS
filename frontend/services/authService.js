import { getSupabaseBrowserClient } from "../lib/supabaseClient";
import useAuthStore from "../store/authStore";
import useTenantStore from "../store/tenantStore";

function buildUser(session) {
  if (!session?.user) return null;
  const appMeta = session.user.app_metadata || {};
  return {
    id: session.user.id,
    email: session.user.email,
    role: appMeta.role || "org_user",
    organization_id: appMeta.organization_id || null,
    organization_name: appMeta.organization_name || null,
  };
}

class AuthService {
  getAuthHeaders() {
    const token = useAuthStore.getState().accessToken;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
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
