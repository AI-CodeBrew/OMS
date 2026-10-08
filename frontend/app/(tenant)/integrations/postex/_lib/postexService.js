// All PostEx API calls in one place, same fetch/getAuthHeaders pattern as
// barq-raftar/_lib/barqraftarService.js - kept inside this feature folder so
// nothing PostEx leaks into the shared services or into BarqRaftar/Smartlane
// code, and vice versa.
import apiConfig from "../../../../../config/apiConfig";
import authService from "../../../../../services/authService";

const BASE = "/api/integrations/postex";

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

const postexService = {
  // Cheap, non-admin-gated status check - the orders page uses this so
  // regular staff (not just org admins) see the PostEx actions.
  async getStatus() {
    return getJson("/status/");
  },

  async getConnection() {
    return getJson("/");
  },

  async connect({ api_token }) {
    return getJson("/", { method: "POST", body: JSON.stringify({ api_token }) });
  },

  async updateSettings(payload) {
    return getJson("/", { method: "PATCH", body: JSON.stringify(payload) });
  },

  // The old secret stops working at once - PostEx's portal must be given
  // the new one.
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

  async getPickupAddresses() {
    return getJson("/pickup-addresses/");
  },

  async addPickupAddress(payload) {
    return getJson("/pickup-addresses/", { method: "POST", body: JSON.stringify(payload) });
  },

  async getShipments({ dateFrom, dateTo, statusId, search } = {}) {
    return getJson(
      `/shipments/${query({ date_from: dateFrom, date_to: dateTo, status_id: statusId, search })}`
    );
  },

  async trackShipment(trackingNumber) {
    return getJson(`/shipments/track/${query({ tracking_number: trackingNumber })}`);
  },

  async shipmentAction(payload) {
    return getJson("/shipments/action/", { method: "POST", body: JSON.stringify(payload) });
  },

  // Merged PDF of PostEx airway bills for the given OMS orders.
  async printAirwayBills(orderIds) {
    return this._downloadPdf(
      "/airway-bills/", { order_ids: orderIds }, "postex-airway-bills", "Failed to print airway bills"
    );
  },

  // Same endpoint keyed by tracking number - for Shipments tab rows, which
  // come from PostEx's own listing and may not be OMS orders.
  async printAirwayBillsByTracking(trackingNumbers) {
    return this._downloadPdf(
      "/airway-bills/", { tracking_numbers: trackingNumbers }, "postex-airway-bills", "Failed to print airway bills"
    );
  },

  // PostEx's own load sheet - also the hand-over step on PostEx's side
  // (their status goes Unbooked -> Booked).
  async printLoadSheet(orderIds) {
    return this._downloadPdf(
      "/loadsheet/", { order_ids: orderIds }, "postex-loadsheet", "Failed to generate load sheet"
    );
  },

  async _downloadPdf(path, body, filePrefix, failMessage) {
    const response = await fetch(`${apiConfig.baseUrl}${BASE}${path}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || failMessage);
    }
    const blob = await response.blob();
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

export default postexService;
