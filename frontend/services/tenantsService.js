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
  listOrganizations({ includeEmails = false } = {}) {
    const qs = includeEmails ? "?include_emails=1" : "";
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organizations}${qs}`);
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

  // false suspends the org (its users are turned away at login and on
  // every request), true reactivates it.
  setOrganizationActive(id, isActive) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organization(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    });
  }

  // Permanent. confirmName must be the org's exact name. Resolves with
  // {name, users_removed, user_errors}.
  deleteOrganization(id, confirmName) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organization(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm_name: confirmName }),
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
