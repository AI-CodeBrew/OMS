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

// Same envelope convention as smartlaneAdminService: these endpoints
// answer {success: false, error} with a 4xx, so a falsy success is an
// error even on a 200.
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

class TicketsAdminService {
  // Cross-org - every organization's tickets, not just one.
  // params: {status, priority, assigned, q, page, page_size}.
  list(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.tickets}${buildQuery(params)}`);
  }

  // Opening a ticket is also how it flips open -> seen on the backend.
  get(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticket(id)}`);
  }

  resolve(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketResolve(id)}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  // Toggles - calling this again while already assigned to you unassigns.
  assignToMe(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketAssign(id)}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  setPriority(id, priority) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketPriority(id)}`, {
      method: "POST",
      body: JSON.stringify({ priority }),
    });
  }

  listMessages(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketMessages(id)}`).then(
      (data) => data.messages || []
    );
  }

  createMessage(id, body, isInternal = false) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketMessages(id)}`, {
      method: "POST",
      body: JSON.stringify({ body, is_internal: isInternal }),
    });
  }
}

export const ticketsAdminService = new TicketsAdminService();
export default ticketsAdminService;
