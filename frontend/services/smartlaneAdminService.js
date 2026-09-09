import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

// Same envelope convention as tenantsService: these endpoints answer
// {success: false, error} with a 4xx, so a falsy success is an error even
// on a 200.
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

class SmartlaneAdminService {
  getConfig() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneConfig}`);
  }

  updateConfig(patch) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneConfig}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  }

  // Resolves for both outcomes - a rejected handshake comes back as
  // {success: true, ok: false, error, debug} because the page needs to
  // render the failure detail, not throw it away.
  testConnection() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneConfigTest}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  listCouriers() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneCouriers}`);
  }

  createCourier(courier) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneCouriers}`, {
      method: "POST",
      body: JSON.stringify(courier),
    });
  }

  updateCourier(id, patch) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneCourier(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  deleteCourier(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneCourier(id)}`, {
      method: "DELETE",
    });
  }

  listStoreLinks(status) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneStores}${qs}`);
  }

  approveStoreLink(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneStoreApprove(id)}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  rejectStoreLink(id, note) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneStoreReject(id)}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  }

  syncStoreLinks() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneStoresSync}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  getStoreWarehouses(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneStoreWarehouses(id)}`);
  }

  // Resolves even when some (or all) requested couriers fail to
  // provision - the response's `errors` array is what the page renders,
  // not something thrown away by a failed-response check.
  provisionStoreWarehouses(id, { city, zip_code } = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.smartlaneStoreWarehousesProvision(id)}`, {
      method: "POST",
      body: JSON.stringify({ city, zip_code }),
    });
  }
}

export const smartlaneAdminService = new SmartlaneAdminService();
export default smartlaneAdminService;
