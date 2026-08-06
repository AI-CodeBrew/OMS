import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import useAuthStore from "../store/authStore";
import useTenantStore from "../store/tenantStore";

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

  async login(email, password) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.auth.login}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const err = new Error(data.error || "Login failed");
      err.code = data.code;
      throw err;
    }

    useAuthStore.getState().setSession({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
    });
    useTenantStore.getState().syncFromAuth();

    return data;
  }

  async me() {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.auth.me}`,
      { headers: this.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const err = new Error(data.error || "Failed to load profile");
      err.code = data.code;
      throw err;
    }
    useAuthStore.getState().setSession({
      accessToken: useAuthStore.getState().accessToken,
      refreshToken: useAuthStore.getState().refreshToken,
      user: data.user,
    });
    useTenantStore.getState().syncFromAuth();
    return data.user;
  }

  logout() {
    useAuthStore.getState().clearSession();
    useTenantStore.getState().clear();
  }
}

export const authService = new AuthService();
export default authService;
