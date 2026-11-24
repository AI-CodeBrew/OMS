import apiConfig from "../config/apiConfig";
import authService from "./authService";
import useAuthStore from "../store/authStore";

// The last /me/ answer for this login - the panel's sidebar and the Hub page
// draw from it at once on the way back (Back from the Hub) instead of
// blank until it is asked again; me() still asks and updates it.
let lastMe = null;
let lastMeFor = "";

function currentUserId() {
  return useAuthStore.getState().user?.id || "";
}

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

// Super admin page -> its address (same order as the panel's sidebar) -
// where a staff login goes when it leaves the Hub.
export const ADMIN_PAGE_HREFS = [
  ["organizations", "/admin/organizations"],
  ["stores", "/admin/stores"],
  ["all_orders", "/admin/all-orders"],
  ["critical_orders", "/admin/critical-orders"],
  ["inventory", "/admin/inventory"],
  ["invoices", "/admin/invoices"],
  ["integrations", "/admin/integrations"],
  ["oms_courier", "/admin/oms-courier"],
  ["logs", "/admin/logs"],
  ["tickets", "/admin/tickets"],
  ["cities", "/admin/cities"],
];

// Where a staff login goes when it leaves a view that opens straight in
// (All Orders, Critical Orders, a Hub-only Dispatch Hub): its first super
// admin page other than `skip`, or null - nowhere, so no back arrow.
// Owners (and when access couldn't be read) keep the usual target.
export function exitTargetFor(access, skip, fallback) {
  if (!access || access.is_owner) return fallback;
  const other = ADMIN_PAGE_HREFS.find(([key]) => !skip.includes(key) && access.permissions?.[key]);
  return other ? other[1] : null;
}

const adminTeamService = {
  // {is_owner, permissions: {page: "read"|"write"}, pages}
  me: async () => {
    const data = await request("/me/");
    lastMe = data;
    lastMeFor = currentUserId();
    return data;
  },
  // The last me() answer for the login signed in now, or null.
  cachedMe: () => (lastMe && lastMeFor && lastMeFor === currentUserId() ? lastMe : null),
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
