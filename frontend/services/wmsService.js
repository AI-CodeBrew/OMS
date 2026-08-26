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

async function request(url, options = {}) {
  const response = await fetch(url, { headers: authService.getAuthHeaders(), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }
  return data;
}

class WmsService {
  // --- Warehouses ---
  async listWarehouses() {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.warehouses}`);
    return data.results || data;
  }

  async createWarehouse({ code, name, is_default = false }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.warehouses}`, {
      method: "POST",
      body: JSON.stringify({ code, name, is_default, is_active: true }),
    });
  }

  // --- Stock ---
  // Returns DRF's paginated shape: {count, next, previous, results}.
  async listStock(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stock}${buildQuery(params)}`);
  }

  async stockSummary() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockSummary}`);
  }

  async createStockItem({ warehouse, sku, product_name, quantity = 0, reorder_level = 0 }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stock}`, {
      method: "POST",
      body: JSON.stringify({ warehouse, sku, product_name, quantity, reorder_level }),
    });
  }

  async adjustStock(id, { delta, note = "" }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockAdjust(id)}`, {
      method: "POST",
      body: JSON.stringify({ delta, note }),
    });
  }

  // --- Movement ledger ---
  async listMovements(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.movements}${buildQuery(params)}`);
  }

  // --- Returns desk ---
  async scanReturn({ orderNumber, note = "" }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.returnScan}`, {
      method: "POST",
      body: JSON.stringify({ order_number: orderNumber, note }),
    });
  }
}

export const wmsService = new WmsService();
export default wmsService;
