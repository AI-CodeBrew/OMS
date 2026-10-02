// All BarqRaftar API calls in one place, same fetch/getAuthHeaders pattern
// as services/integrationsService.js (Smartlane/Shopify) and
// services/ordersService.js - deliberately kept inside this feature folder
// rather than added to either of those shared files, per the "everything
// BarqRaftar lives under integrations/barq-raftar/" instruction. Nothing
// here is imported by Smartlane/Shopify code, and this never imports from
// them either.
import apiConfig from "../../../../../config/apiConfig";
import authService from "../../../../../services/authService";

const BASE = "/api/integrations/barqraftar";

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

const barqraftarService = {
  // Cheap, non-admin-gated status check - the orders page and the "Book
  // with BarqRaftar" / "Print BarqRaftar Labels" actions use this, so
  // regular staff (not just org admins) see them when connected.
  async getStatus() {
    return getJson("/status/");
  },

  async getConnection() {
    return getJson("/");
  },

  async connect({ api_key, api_secret }) {
    return getJson("/", { method: "POST", body: JSON.stringify({ api_key, api_secret }) });
  },

  async updateSettings(payload) {
    return getJson("/", { method: "PATCH", body: JSON.stringify(payload) });
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

  async savePickupAddress(payload) {
    return getJson("/pickup-addresses/", { method: "POST", body: JSON.stringify(payload) });
  },

  async getShipments(filters = {}) {
    return getJson(`/shipments/${query(filters)}`);
  },

  async trackShipment({ trackingNumber, referenceId }) {
    return getJson(`/shipments/track/${query({ tracking_number: trackingNumber, reference_id: referenceId })}`);
  },

  async shipmentAction(payload) {
    return getJson("/shipments/action/", { method: "POST", body: JSON.stringify(payload) });
  },

  async getPayments({ dateFrom, dateTo, page, limit } = {}) {
    return getJson(`/payments/${query({ date_from: dateFrom, date_to: dateTo, page, limit })}`);
  },

  async getPaymentDetail(paymentId) {
    return getJson(`/payments/${paymentId}/`);
  },

  // Downloads a merged PDF of BarqRaftar labels for the given orders -
  // same blob-download shape as ordersService.js's printSmartlaneAirwayBill.
  async printLabels(orderIds) {
    return this._downloadPdf("/labels/", { order_ids: orderIds }, "barqraftar-labels", "Failed to print labels");
  },

  // Same endpoint, keyed by tracking number instead - used by the
  // Shipments tab, whose rows come from BarqRaftar's own listing and
  // don't carry an OMS order id.
  async printLabelsByTracking(trackingNumbers) {
    return this._downloadPdf(
      "/labels/", { tracking_numbers: trackingNumbers }, "barqraftar-labels", "Failed to print labels"
    );
  },

  // Our own "Goods Load Sheet" PDF (BarqRaftar's API has none) - see
  // backend/integrations/barqraftar/loadsheet.py.
  async printLoadSheet(orderIds) {
    return this._downloadPdf(
      "/loadsheet/", { order_ids: orderIds }, "barqraftar-loadsheet", "Failed to generate load sheet"
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

export default barqraftarService;
