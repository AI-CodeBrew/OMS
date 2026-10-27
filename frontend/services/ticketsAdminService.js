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
  // params: {status, q, page, page_size}.
  list(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.tickets}${buildQuery(params)}`);
  }

  // FynkTech raising a ticket to a store: {organization_id, order?,
  // category, sub_category, description} - always saved "By Admin".
  create(payload) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.tickets}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((data) => data.ticket);
  }

  // One store's orders matching q - the New ticket form's order picker.
  searchStoreOrders(organizationId, q) {
    return request(
      `${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketStoreOrders}${buildQuery({ organization_id: organizationId, q })}`
    ).then((data) => data.orders || []);
  }

  get(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticket(id)}`);
  }

  resolve(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketResolve(id)}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  // Any of TICKET_STATUSES - the admin's ticket actions.
  setStatus(id, status) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.ticketStatus(id)}`, {
      method: "POST",
      body: JSON.stringify({ status }),
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
