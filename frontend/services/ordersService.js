import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

class OrdersService {
  async list() {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.orders}`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ([]));
    if (!response.ok) {
      const err = new Error(data.detail || "Failed to load orders");
      throw err;
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
}

export const ordersService = new OrdersService();
export default ordersService;
