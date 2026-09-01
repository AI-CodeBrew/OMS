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

class OrdersService {
  // Returns DRF's paginated shape: {count, next, previous, results}.
  async list(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orders}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({ count: 0, results: [] }));
    if (!response.ok) {
      throw new Error(data.detail || "Failed to load orders");
    }
    return data;
  }

  async dashboard(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderDashboard}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Failed to load dashboard");
    }
    return data;
  }

  async returnsSummary(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderReturnsSummary}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Failed to load returns summary");
    }
    return data;
  }

  async counts(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderCounts}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Failed to load order counts");
    }
    return data;
  }

  async create(order) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orders}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify(order),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data.detail || (typeof data === "object" ? JSON.stringify(data) : "Failed to create order");
      throw new Error(message);
    }
    return data;
  }

  async bulkAction({ action, orderIds, params = {} }) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderBulkAction}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ action, order_ids: orderIds, params }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // A 500 renders as HTML, so `data` is empty and there's no `detail` to
      // show - fall back to the status code rather than a bare "Bulk action
      // failed" that tells the user nothing about what went wrong.
      throw new Error(data.detail || `Bulk action failed (HTTP ${response.status})`);
    }
    return data;
  }

  async scanDispatch({ orderNumber, trackingNumber = "" }) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderScanDispatch}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ order_number: orderNumber, tracking_number: trackingNumber }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Scan failed");
    }
    return data;
  }

  async scanReturn({ orderNumber, reason = "" }) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderScanReturn}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ order_number: orderNumber, reason }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Scan failed");
    }
    return data;
  }

  async _postForDocument(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to generate document");
    }
    return response.blob();
  }

  async _postAndDownloadDocument(url, body, filename) {
    const blob = await this._postForDocument(url, body);
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  }

  // Real Smartlane-generated documents (proxied from Smartlane's own api,
  // rendered to actual PDF server-side) - always match whichever courier
  // Smartlane actually booked.
  async printSmartlaneAirwayBill(orderIds) {
    const dateStamp = new Date().toISOString().slice(0, 10);
    await this._postAndDownloadDocument(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderSmartlaneAirwayBill}`,
      { order_ids: orderIds },
      `airway-bill-${dateStamp}.pdf`
    );
  }

  async printSmartlaneLoadSheet(orderIds, courier) {
    const dateStamp = new Date().toISOString().slice(0, 10);
    await this._postAndDownloadDocument(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderSmartlaneLoadSheet}`,
      { order_ids: orderIds, courier },
      `loadsheet-${courier}-${dateStamp}.pdf`
    );
  }

  async exportCsv(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderExport}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    if (!response.ok) {
      throw new Error("Export failed");
    }
    return response.blob();
  }

  // Uploads a courier/settlement sheet. Defaults to a preview: nothing is
  // written unless apply is true, so the UI can show the diff first.
  async importCsv(file, { apply = false, overwriteFinal = false } = {}) {
    const form = new FormData();
    form.append("file", file);
    form.append("apply", apply ? "true" : "false");
    form.append("overwrite_final", overwriteFinal ? "true" : "false");

    // Content-Type is dropped on purpose - the browser has to set it so the
    // multipart boundary is included.
    const headers = { ...authService.getAuthHeaders() };
    delete headers["Content-Type"];

    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderImport}`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Import failed");
    }
    return data;
  }

  async get(id) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.order(id)}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Failed to load order");
    }
    return data;
  }

  async update(id, patch) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.order(id)}`, {
      method: "PATCH",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify(patch),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data.detail || (typeof data === "object" ? JSON.stringify(data) : "Failed to save order");
      throw new Error(message);
    }
    return data;
  }

  async listNotes(orderId, kind) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderNotes(orderId)}${buildQuery({ kind })}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(data.detail || "Failed to load notes");
    return data;
  }

  async createNote(orderId, { kind, body }) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderNotes(orderId)}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ kind, body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to add note");
    return data;
  }

  async listTransactions(orderId) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderTransactions(orderId)}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(data.detail || "Failed to load transactions");
    return data;
  }

  async createTransaction(orderId, transaction) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderTransactions(orderId)}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify(transaction),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to add transaction");
    return data;
  }

  async listLog(orderId) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderLog(orderId)}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(data.detail || "Failed to load order log");
    return data;
  }

  async listCustomerHistory(orderId) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderCustomerHistory(orderId)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(data.detail || "Failed to load customer history");
    return data;
  }

  async listSplitOrders(orderId) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderSplitOrders(orderId)}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(data.detail || "Failed to load split orders");
    return data;
  }

  async createSplit(orderId, items) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orderSplit(orderId)}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ items }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to split order");
    return data;
  }
}

export const ordersService = new OrdersService();
export default ordersService;
