// All Leopards API calls in one place, same fetch/getAuthHeaders pattern as
// postex/_lib/postexService.js - kept inside this feature folder so nothing
// Leopards leaks into the shared services or into PostEx/BarqRaftar/Smartlane
// code, and vice versa.
import apiConfig from "../../../../../config/apiConfig";
import authService from "../../../../../services/authService";

const BASE = "/api/integrations/leopards";

async function getJson(path, options = {}) {
  const response = await fetch(`${apiConfig.baseUrl}${BASE}${path}`, {
    headers: authService.getAuthHeaders(),
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Request failed");
  return data;
}

function query(params = {}) {
  const usable = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (usable.length === 0) return "";
  return `?${new URLSearchParams(usable).toString()}`;
}

const leopardsService = {
  // Cheap, non-admin-gated status check - the orders page uses this so
  // regular staff (not just org admins) see the Leopards actions.
  async getStatus() {
    return getJson("/status/");
  },

  async getConnection() {
    return getJson("/");
  },

  async connect({ api_key, api_password }) {
    return getJson("/", { method: "POST", body: JSON.stringify({ api_key, api_password }) });
  },

  async updateSettings(payload) {
    return getJson("/", { method: "PATCH", body: JSON.stringify(payload) });
  },

  // The old secret stops working at once - what's registered with Leopards
  // must be updated with the new one.
  async regenerateWebhookSecret() {
    return getJson("/", { method: "PATCH", body: JSON.stringify({ regenerate_webhook_secret: true }) });
  },

  async disconnect() {
    const response = await fetch(`${apiConfig.baseUrl}${BASE}/`, {
      method: "DELETE",
      headers: authService.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Failed to disconnect");
  },

  async syncNow() {
    return getJson("/sync/", { method: "POST" });
  },

  async getSyncJobStatus() {
    return getJson("/sync/");
  },

  async cancelSync() {
    return getJson("/sync/", { method: "DELETE" });
  },

  async getCities(refresh = false) {
    return getJson(`/cities/${refresh ? "?refresh=1" : ""}`);
  },

  // The parcels booked through OMS (Leopards has no "list everything" call).
  async getShipments({ dateFrom, dateTo, search } = {}) {
    return getJson(`/shipments/${query({ date_from: dateFrom, date_to: dateTo, search })}`);
  },

  async trackShipment(trackingNumber) {
    return getJson(`/shipments/track/${query({ tracking_number: trackingNumber })}`);
  },

  async shipmentAction(payload) {
    return getJson("/shipments/action/", { method: "POST", body: JSON.stringify(payload) });
  },

  // Merged PDF of Leopards slips (airway bills) for the given OMS orders.
  // If a slip link isn't a PDF the backend answers JSON {slip_links}, and
  // the links are opened instead.
  async printAirwayBills(orderIds) {
    const response = await fetch(`${apiConfig.baseUrl}${BASE}/airway-bills/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ order_ids: orderIds }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to print airway bills");
    }
    if ((response.headers.get("Content-Type") || "").includes("json")) {
      const data = await response.json().catch(() => ({}));
      (data.slip_links || []).forEach((url) => window.open(url, "_blank", "noopener"));
      return;
    }
    this._saveBlob(await response.blob(), "leopards-airway-bills");
  },

  // Leopards' own load sheet - also the hand-over step on Leopards' side.
  async printLoadSheet(orderIds) {
    const response = await fetch(`${apiConfig.baseUrl}${BASE}/loadsheet/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ order_ids: orderIds }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to generate load sheet");
    }
    this._saveBlob(await response.blob(), "leopards-loadsheet");
  },

  _saveBlob(blob, filePrefix) {
    const dateStamp = new Date().toISOString().slice(0, 10);
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${filePrefix}-${dateStamp}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  },
};

export default leopardsService;
