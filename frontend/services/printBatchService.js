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

class PrintBatchService {
  // Returns DRF's paginated shape: {count, next, previous, results}.
  async list(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.printBatches}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({ count: 0, results: [] }));
    if (!response.ok) throw new Error(data.detail || "Failed to load batches");
    return data;
  }

  // The saved copy, exactly as generated - never regenerated.
  async _fetchDocument(batch, { inline = false } = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.printBatchDownload(batch.id)}${inline ? "?inline=1" : ""}`,
      { headers: authService.getAuthHeaders() }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Download failed");
    }
    return response.blob();
  }

  // `prefix` (e.g. a batch number) lets several documents from the same
  // day download under distinguishable names.
  async download(batch, prefix = "") {
    const blob = await this._fetchDocument(batch);
    const url = window.URL.createObjectURL(blob);
    const ext = batch.content_type === "application/pdf" ? "pdf" : "html";
    const link = document.createElement("a");
    link.href = url;
    // updated_at, not created_at - a reprint reuses this row (see
    // backend batch_services.save_print_batch), so this reflects when it
    // was last actually generated.
    link.download = `${prefix ? `${prefix}-` : ""}${batch.kind}-${(batch.updated_at || "").slice(0, 10)}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  // Prints the saved PDF straight from the page: loaded into a hidden
  // iframe and handed to the browser's print dialog. Falls back to opening
  // it in a new tab (whose viewer has its own print button) where a
  // browser won't print a framed PDF.
  async print(batch) {
    const blob = await this._fetchDocument(batch, { inline: true });
    const url = window.URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        window.open(url, "_blank");
      }
    };
    document.body.appendChild(frame);
    // The print dialog reads from the frame - removing it (or revoking the
    // url) too soon would blank what's being printed.
    setTimeout(() => {
      frame.remove();
      window.URL.revokeObjectURL(url);
    }, 120000);
  }

  // Batch History: {count, next, previous, results} of dispatch batches,
  // each with its orders (entries) and documents.
  async listBatches(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.dispatchBatches}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({ count: 0, results: [] }));
    if (!response.ok) throw new Error(data.detail || "Failed to load batches");
    return data;
  }

  async listBatchCouriers() {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.dispatchBatchCouriers}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(data.detail || "Failed to load couriers");
    return data;
  }

  // Returns the updated batch. The orders and the documents already
  // generated are left as they were.
  async removeOrders(batchId, orderNumbers) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.dispatchBatchRemoveOrders(batchId)}`,
      {
        method: "POST",
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({ order_numbers: orderNumbers }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to remove orders");
    return data;
  }

  // One row per calendar date - every order that reached Ready to Print
  // that day, regardless of whether/when anyone printed anything for it.
  async listDaily(params = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.dailyPrintBatches}${buildQuery(params)}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(data.detail || "Failed to load daily batches");
    return data;
  }
}

export const printBatchService = new PrintBatchService();
export default printBatchService;
