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
  // The Stores tab's Service model (all_in_one / fulfilment / courier /
  // oms_only, or "" to clear).
  setServiceModel(id, serviceModel) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organization(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ service_model: serviceModel }),
    });
  }

  // "Keep updating orders from Shopify" (OMS Testing only). Turning it on
  // also starts a full Shopify order sync for the store.
  setShopifyResync(id, enabled) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organization(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ shopify_resync_orders: enabled }),
    });
  }

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

  // An organization with several stores: put a store inside this
  // organization (its inventory joins the organization's), or take it out.
  addStoreToOrganization(id, storeId) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organization(id)}stores/`, {
      method: "POST",
      body: JSON.stringify({ store_id: storeId }),
    });
  }

  removeStoreFromOrganization(id, storeId) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.organization(id)}stores/`, {
      method: "DELETE",
      body: JSON.stringify({ store_id: storeId }),
    });
  }

  // organizationId: the store whose member this is - only that store's
  // login changes (a super admin's own login never does).
  updateMember(userId, { email, password, organizationId }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.user(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ email, password, organization_id: organizationId }),
    });
  }
}

export const tenantsService = new TenantsService();
export default tenantsService;
