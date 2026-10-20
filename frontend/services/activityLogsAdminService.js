import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// Same envelope convention as ticketsAdminService.
async function request(url) {
  const response = await fetch(url, { headers: authService.getAuthHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const err = new Error(data.error || data.detail || "Request failed");
    err.status = response.status;
    throw err;
  }
  return data;
}

class ActivityLogsAdminService {
  // Cross-org. params: {organization (store id, or "platform"), q, from,
  // to, entity_type + entity_id (one order's history), order ("asc"), page, page_size}.
  list(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.activityLogs}${buildQuery(params)}`);
  }
}

export const activityLogsAdminService = new ActivityLogsAdminService();
export default activityLogsAdminService;
