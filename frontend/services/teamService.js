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
    const err = new Error(data.error || data.detail || "Request failed");
    err.code = data.code;
    err.status = response.status;
    throw err;
  }
  return data;
}

class TeamService {
  listMembers() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.team}`);
  }

  inviteMember({ username, password, modules }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.team}`, {
      method: "POST",
      body: JSON.stringify({ username, password, modules }),
    });
  }

  updateMember(userId, { modules, username, password }) {
    const body = {};
    if (modules !== undefined) body.modules = modules;
    if (username !== undefined) body.username = username;
    if (password !== undefined) body.password = password;
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.teamMember(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  removeMember(userId) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.teamMember(userId)}`, {
      method: "DELETE",
    });
  }

  // This store's Logs. params: {from, to, q, entity_type, entity_id,
  // order, page, page_size} - same as the super admin's activity logs.
  listAuditLogs(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    });
    const qs = search.toString();
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.auditLogs}${qs ? `?${qs}` : ""}`);
  }
}

export const teamService = new TeamService();
export default teamService;
