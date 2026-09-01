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

class ReportsService {
  async getSummary({ dateFrom, dateTo } = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.report}${buildQuery({ date_from: dateFrom, date_to: dateTo })}`,
      { headers: authService.getAuthHeaders() }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to load report");
    return data;
  }

  async downloadCsv({ dateFrom, dateTo } = {}) {
    const response = await fetch(
      `${apiConfig.baseUrl}${API_ENDPOINTS.oms.report}${buildQuery({
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
    link.download = `report_${dateFrom || "all"}_to_${dateTo || "all"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }
}

export const reportsService = new ReportsService();
export default reportsService;
