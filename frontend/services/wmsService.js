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

// DRF's field errors ({"name": ["This field is required."]}) as one line,
// for responses without a `detail`.
function fieldErrors(data) {
  return Object.entries(data || {})
    .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(" ") : errors}`)
    .join("; ");
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: authService.getAuthHeaders(), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || fieldErrors(data) || "Request failed");
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

  // Add Warehouse on the Purchase Orders page - its code is made from the name.
  async addWarehouse({ name, city, address, poc_name, poc_phone, remark }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.warehouses}`, {
      method: "POST",
      body: JSON.stringify({ name, city, address, poc_name, poc_phone, remark, is_active: true }),
    });
  }

  // --- Suppliers / Purchase orders ---
  async listSuppliers() {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.suppliers}`);
    return data.results || data;
  }

  async addSupplier({ name, phone, city }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.suppliers}`, {
      method: "POST",
      body: JSON.stringify({ name, phone, city }),
    });
  }

  // {count, results} - params: state (received | partial | not_received), search, page, page_size.
  async listPurchaseOrders(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.purchaseOrders}${buildQuery(params)}`);
  }

  async purchaseOrderSummary() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.purchaseOrderSummary}`);
  }

  // { supplier, warehouse, ordered_at, lines: [{sku, product_name, image_url,
  // quantity_ordered, unit_price, good, damaged}] }
  async createPurchaseOrder(payload) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.purchaseOrders}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // receipts: [{line, good, damaged}] - added to what's already received.
  async receivePurchaseOrder(id, receipts) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.purchaseOrderReceive(id)}`, {
      method: "POST",
      body: JSON.stringify({ receipts }),
    });
  }

  // { sku, product_name, image_url } for an exact SKU, or null if there's none.
  async purchaseOrderProduct(sku) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.wms.purchaseOrderProduct}${buildQuery({ sku })}`,
      { headers: authService.getAuthHeaders() }
    );
    if (response.status === 404) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Lookup failed");
    return data;
  }

  async syncPurchaseOrderProducts() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.purchaseOrderSyncShopify}`, { method: "POST" });
  }

  // --- Stock ---
  // Returns DRF's paginated shape: {count, next, previous, results}.
  async listStock(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stock}${buildQuery(params)}`);
  }

  async stockSummary(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockSummary}${buildQuery(params)}`);
  }

  // The Inventory page: {count, results, summary: {total, active, inactive,
  // out_of_stock}} - params: activity, search, page, page_size.
  async inventoryOverview(params = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockOverview}${buildQuery(params)}`);
  }

  // One item's details: {item, orders, purchases, movements}.
  async inventoryReport(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockReport(id)}`);
  }

  async downloadInventoryReport(id, filename) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockReport(id)}?export=csv`, {
      headers: authService.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Report download failed");
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async downloadStockReportCsv({ dateFrom, dateTo } = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockSummary}${buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
        export: "csv",
      })}`,
      { headers: authService.getAuthHeaders() }
    );
    if (!response.ok) throw new Error("Report export failed");
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wms_report_${dateFrom || "all"}_to_${dateTo || "all"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
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

  // delta and/or product_name - omit either to leave it unchanged.
  async adjustStock(id, { delta, note = "", product_name } = {}) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockAdjust(id)}`, {
      method: "POST",
      body: JSON.stringify({ delta, note, product_name }),
    });
  }

  // Push to Shopify: the confirmation summary, then the confirmed
  // changes sent back in small batches (each row's `expected` values).
  async shopifyPendingChanges() {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockShopifyPending}`);
  }

  // Multipart (images), so the JSON Content-Type from getAuthHeaders is
  // dropped and the browser sets the multipart boundary itself.
  async createStockItemOnShopify({ sku, product_name, price, quantity, reorder_level = 0, images = [] }) {
    const body = new FormData();
    body.append("sku", sku);
    body.append("product_name", product_name);
    body.append("price", price);
    body.append("quantity", quantity);
    body.append("reorder_level", reorder_level);
    images.forEach((file) => body.append("images", file));
    const { "Content-Type": _json, ...headers } = authService.getAuthHeaders();
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockCreateOnShopify}`, {
      method: "POST",
      headers,
      body,
    });
  }

  async pushChangesToShopify(changes) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.stockPushShopify}`, {
      method: "POST",
      body: JSON.stringify({ changes }),
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

  // breakdown: [{key, good, damaged, lost}] per line (the receive popup) -
  // only good units are restocked. Without it, condition applies to all.
  async scanReturn({ trackingNumber, orderNumber, condition, breakdown, note = "" }) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.wms.returnScan}`, {
      method: "POST",
      body: JSON.stringify({
        tracking_number: trackingNumber,
        order_number: orderNumber,
        condition,
        breakdown,
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
