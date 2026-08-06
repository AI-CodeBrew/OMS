import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

class HealthService {
  async getPublicHealth() {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.health}`,
      { headers: { Accept: "application/json" } }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const err = new Error(data.error || "Health check failed");
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async getProtectedHealth() {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.healthProtected}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const err = new Error(data.error || "Protected health check failed");
      err.code = data.code;
      throw err;
    }
    return data;
  }
}

export const healthService = new HealthService();
export default healthService;
