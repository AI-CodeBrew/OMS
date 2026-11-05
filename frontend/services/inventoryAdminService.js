import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

async function request(url) {
  const response = await fetch(url, { headers: authService.getAuthHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.detail || "Request failed");
  }
  return data;
}

function query(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") qs.set(key, value);
  });
  const text = qs.toString();
  return text ? `?${text}` : "";
}

// The super admin's Inventory (backend: wms.inventory_admin_views) - every
// store's Inventory rows in one list, each with its store_name. Read only.
const inventoryAdminService = {
  // {count, results, summary} - params: page, page_size, search, activity.
  async list(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.inventory}${query(params)}`);
  },
  // One item's details (the eye): {item, orders, purchases, movements}.
  async report(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.inventoryReport(id)}`);
  },
};

export default inventoryAdminService;
