import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService, { buildUser } from "./authService";
import { getSupabaseBrowserClient } from "../lib/supabaseClient";
import useAuthStore from "../store/authStore";

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authService.getAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

class StoresService {
  // Every store the signed-in login belongs to, current store first.
  async list() {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.stores}`);
    return data.stores || [];
  }

  // Adds another store to this same login (another Shopify store, or a
  // manual CSV-only one) and makes the caller its org admin.
  async create({ name, isManualStore = false }) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.stores}`, {
      method: "POST",
      body: JSON.stringify({ name, is_manual_store: isManualStore }),
    });
    return data.store;
  }

  // Points the login's JWT at another store it belongs to, then refreshes
  // the local Supabase session so authStore picks up the new app_metadata.
  // Resolves with the refreshed user, same shape authService.login()
  // returns.
  async switchTo(organizationId) {
    await request(`${apiConfig.baseUrl}${API_ENDPOINTS.storesSwitch}`, {
      method: "POST",
      body: JSON.stringify({ organization_id: organizationId }),
    });

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      throw new Error(error?.message || "Switched store, but couldn't refresh the session.");
    }
    const user = buildUser(data.session);
    useAuthStore.getState().setSession({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user,
    });
    return user;
  }
}

export const storesService = new StoresService();
export default storesService;
