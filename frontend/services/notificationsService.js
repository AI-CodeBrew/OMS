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
    throw new Error(data.error || data.detail || "Request failed");
  }
  return data;
}

class NotificationsService {
  // { notifications: [...], unread_count }
  async list() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.notifications}`);
  }

  // Marks every unread one read (or just `ids`).
  async markRead(ids) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.notificationsRead}`, {
      method: "POST",
      body: JSON.stringify(ids ? { ids } : {}),
    });
  }
}

export const notificationsService = new NotificationsService();
export default notificationsService;
