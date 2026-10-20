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
  // Cross-org. params: {organization (id or "platform"), actor, category,
  // outcome, q, from, to, order ("asc" for playback), page, page_size}.
  list(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.activityLogs}${buildQuery(params)}`);
  }

  // Same filters - totals, per-day counts, per-store counts, top people.
  summary(params = {}) {
    return request(
      `${apiConfig.baseUrl}${API_ENDPOINTS.admin.activityLogsSummary}${buildQuery(params)}`
    );
  }
}

export const activityLogsAdminService = new ActivityLogsAdminService();
export default activityLogsAdminService;
