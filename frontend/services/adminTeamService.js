import apiConfig from "../config/apiConfig";
import authService from "./authService";

// Super admin side access: this login's own pages (me), and - owners only -
// the Admin Team page's staff logins and roles (backend core.admin_views).
const BASE = "/api/core/admin";

async function request(path, options = {}) {
  const response = await fetch(`${apiConfig.baseUrl}${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authService.getAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const err = new Error(data.error || data.detail || "Request failed");
    err.status = response.status;
    throw err;
  }
  return data;
}

const adminTeamService = {
  // {is_owner, permissions: {page: "read"|"write"}, pages}
  me: () => request("/me/"),
  overview: () => request("/team/"),
  // {email, password, name, role_id} or {..., permissions}
  createStaff: (body) => request("/team/", { method: "POST", body: JSON.stringify(body) }),
  // {name?, password?} and/or {access: true, role_id | permissions}
  updateStaff: (userId, body) => request(`/team/${userId}/`, { method: "PATCH", body: JSON.stringify(body) }),
  removeStaff: (userId) => request(`/team/${userId}/`, { method: "DELETE" }),
  createRole: (body) => request("/roles/", { method: "POST", body: JSON.stringify(body) }),
  updateRole: (id, body) => request(`/roles/${id}/`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRole: (id) => request(`/roles/${id}/`, { method: "DELETE" }),
};

export default adminTeamService;
