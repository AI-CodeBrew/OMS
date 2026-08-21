import apiConfig from "../config/apiConfig";
import authService from "./authService";

const SHOPIFY_BASE = "/api/integrations/shopify";

class IntegrationsService {
  async getShopifyStatus() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to load integration status");
    return data;
  }

  async connectShopify({ shop_domain, access_token, webhook_secret }) {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ shop_domain, access_token, webhook_secret }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to connect Shopify");
    return data;
  }

  async syncNow() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/sync/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Sync failed");
    return data;
  }
}

export const integrationsService = new IntegrationsService();
export default integrationsService;
