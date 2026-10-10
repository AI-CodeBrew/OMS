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

class IntegrationsAdminService {
  // One row per store, one entry per integration (null = never set up).
  async listStoreIntegrations() {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.integrations}`);
    return data.stores || [];
  }

  // { organization: {id, name}, accounts: {smartlane, barq_raftar, postex},
  //   smartlane_business: {configured, active, pending_requests} }
  async getOmsCourier() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.omsCourier}`);
  }
}

export const integrationsAdminService = new IntegrationsAdminService();
export default integrationsAdminService;
