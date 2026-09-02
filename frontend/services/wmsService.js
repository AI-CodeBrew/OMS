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

  async importSkusFromOrders() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockImportSkus}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async syncStockFromShopify() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockSyncShopify}`, {
      method: "POST",
      body: JSON.stringify({}),
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
  // Read-only - confirms a parcel is receivable before asking the
  // operator for its condition. Nothing is written until scanReturn.
  // trackingNumber is what the scan panel sends (the physical label's own
  // barcode); orderNumber is what the table's row/bulk buttons send
  // instead, since they already know exactly which order they mean.
  async lookupReturn({ trackingNumber, orderNumber }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.returnLookup}`, {
      method: "POST",
      body: JSON.stringify({ tracking_number: trackingNumber, order_number: orderNumber }),
    });
  }

  async scanReturn({ trackingNumber, orderNumber, condition, note = "" }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.returnScan}`, {
      method: "POST",
      body: JSON.stringify({
        tracking_number: trackingNumber,
        order_number: orderNumber,
        condition,
        note,
      }),
    });
  }

  // Returns {results: [{order_number, success, reason?, restocked?}, ...]} -
  // one entry per requested order, successes and failures side by side.
  async bulkReceiveReturns({ orderNumbers, condition, note = "" }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.returnBulkReceive}`, {
      method: "POST",
      body: JSON.stringify({ order_numbers: orderNumbers, condition, note }),
    });
  }

  // --- Packing station ---
  // trackingNumber (scan panel) or orderNumber (table row/bulk button) -
  // see lookupReturn above for why there are two.
  async scanPacked({ trackingNumber, orderNumber }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.packingScan}`, {
      method: "POST",
      body: JSON.stringify({ tracking_number: trackingNumber, order_number: orderNumber }),
    });
  }

  async bulkPack({ orderNumbers }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.packingBulkPack}`, {
      method: "POST",
      body: JSON.stringify({ order_numbers: orderNumbers }),
    });
  }
}

export const wmsService = new WmsService();
export default wmsService;
