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

class TicketsService {
  // No `order` param -> "my tickets" (the sidebar page). {order: id} ->
  // every ticket on that order, regardless of who raised it (the order
  // tab). Returns DRF's paginated shape: {count, next, previous, results}.
  async list(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.tickets}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({ count: 0, results: [] }));
    if (!response.ok) throw new Error(data.detail || "Failed to load tickets");
    return data;
  }

  async get(id) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.ticket(id)}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to load ticket");
    return data;
  }

  async create({ order, category, sub_category, description, priority }) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.tickets}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ order, category, sub_category, description, priority }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data.detail || (typeof data === "object" ? JSON.stringify(data) : "Failed to raise ticket");
      throw new Error(message);
    }
    return data;
  }

  async listMessages(id) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.ticketMessages(id)}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(data.detail || "Failed to load conversation");
    return data;
  }

  async createMessage(id, body) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.ticketMessages(id)}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to send message");
    return data;
  }
}

export const ticketsService = new TicketsService();
export default ticketsService;
