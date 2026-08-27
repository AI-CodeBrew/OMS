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
    const err = new Error(data.error || "Request failed");
    err.code = data.code;
    err.status = response.status;
    throw err;
  }
  return data;
}

class TenantsService {
  listOrganizations() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organizations}`);
  }

  getOrganization(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organization(id)}`);
  }

  createOrganization({ name, email, password, plan, slug, modules }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organizations}`, {
      method: "POST",
      body: JSON.stringify({ name, email, password, plan, slug, modules }),
    });
  }

  updateMember(userId, { email, password }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.user(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ email, password }),
    });
  }
}

export const tenantsService = new TenantsService();
export default tenantsService;
