import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

// Same envelope convention as ticketsAdminService: {success: false, error}
// with a 4xx, so a falsy success is an error even on a 200.
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...authService.getAuthHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.detail || "Request failed");
  }
  return data;
}

// The super admin's city list - every order's city must be on it before the
// order can be Approved. Every call answers with {count, cities} for the
// list as it now stands.
class CitiesAdminService {
  list(q = "") {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.cities}${qs}`);
  }

  // names: one city per line, or an array. Answers {added, count, cities}.
  add(names) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.cities}`, {
      method: "POST",
      body: JSON.stringify({ names }),
    });
  }

  remove(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.city(id)}`, { method: "DELETE" });
  }

  // Pulls PostEx's and BarqRaftar's city lists. Answers {added: {courier: n},
  // errors: {courier: message}, count, cities}.
  importFromCouriers() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.citiesImport}`, { method: "POST" });
  }
}

const citiesAdminService = new CitiesAdminService();
export default citiesAdminService;
