import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

class CouriersService {
  async list() {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.couriers}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) {
      throw new Error(data.detail || "Failed to load couriers");
    }
    return data;
  }

  async create({ name }) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.couriers}`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ name }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Failed to create courier");
    }
    return data;
  }
}

export const couriersService = new CouriersService();
export default couriersService;
