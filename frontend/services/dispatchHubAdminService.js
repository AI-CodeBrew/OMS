import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

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

class DispatchHubAdminService {
  async listStores() {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.dispatchHub}`);
    return data.stores || [];
  }

  // Adds a store to the Hub, or updates its rate if it's already in.
  async addStore(organizationId, perOrderRate) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.dispatchHub}`, {
      method: "POST",
      body: JSON.stringify({ organization_id: organizationId, per_order_rate: perOrderRate }),
    });
    return data.stores || [];
  }

  async updateRate(organizationId, perOrderRate) {
    const data = await request(
      `${apiConfig.baseUrl}${API_ENDPOINTS.admin.dispatchHubStore(organizationId)}`,
      { method: "PATCH", body: JSON.stringify({ per_order_rate: perOrderRate }) }
    );
    return data.stores || [];
  }

  async removeStore(organizationId) {
    const data = await request(
      `${apiConfig.baseUrl}${API_ENDPOINTS.admin.dispatchHubStore(organizationId)}`,
      { method: "DELETE" }
    );
    return data.stores || [];
  }
}

export const dispatchHubAdminService = new DispatchHubAdminService();
export default dispatchHubAdminService;
