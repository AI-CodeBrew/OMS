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

  async download(batch) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.printBatchDownload(batch.id)}`,
      { headers: authService.getAuthHeaders() }
    );
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const ext = batch.content_type === "application/pdf" ? "pdf" : "html";
    const link = document.createElement("a");
    link.href = url;
    // updated_at, not created_at - a reprint reuses this row (see
    // backend _save_print_batch), so this reflects when it was last
    // actually generated.
    link.download = `${batch.kind}-${(batch.updated_at || "").slice(0, 10)}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
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
