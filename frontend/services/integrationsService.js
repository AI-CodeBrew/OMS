import apiConfig from "../config/apiConfig";
import authService from "./authService";

const SHOPIFY_BASE = "/api/integrations/shopify";
const SMARTLANE_BASE = "/api/integrations/smartlane";

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

  async testConnection({ shop_domain, access_token }) {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/test/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ shop_domain, access_token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.detail || "Connection test failed");
    return data;
  }

  async setAutoSyncOrders(enabled) {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/`, {
      method: "PATCH",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ auto_sync_orders: enabled }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to update setting");
    return data;
  }

  async setWebhooksActive(enabled) {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/`, {
      method: "PATCH",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ webhooks_active: enabled }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to update webhooks");
    return data;
  }

  async disconnect() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/`, {
      method: "DELETE",
      headers: authService.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Failed to disconnect");
  }

  async syncNow({ full = false, dateFrom, dateTo, ranges } = {}) {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/sync/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({
        full,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        ranges: ranges?.length ? ranges : undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Sync failed");
    return data;
  }

  async getSyncJobStatus() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/sync/`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to load sync status");
    return data;
  }

  async checkGaps() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/gaps/`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to check for missing orders");
    return data;
  }

  async cancelSync() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/sync/`, {
      method: "DELETE",
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to cancel sync");
    return data;
  }

  async getSmartlaneStatus() {
    const response = await fetch(`${apiConfig.baseUrl}${SMARTLANE_BASE}/`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to load integration status");
    return data;
  }

  async connectSmartlane({ api_key, webhook_secret, store_warehouse_code }) {
    const response = await fetch(`${apiConfig.baseUrl}${SMARTLANE_BASE}/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ api_key, webhook_secret, store_warehouse_code }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to connect Smartlane");
    return data;
  }

  async updateSmartlaneWarehouse(store_warehouse_code) {
    const response = await fetch(`${apiConfig.baseUrl}${SMARTLANE_BASE}/`, {
      method: "PATCH",
      headers: authService.getAuthHeaders(),
      body: JSON.stringify({ store_warehouse_code }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to save warehouse code");
    return data;
  }

  // Runs the Smartlane status poll for this org on demand - the same pull
  // the scheduled poller does, for when you'd rather not wait for a webhook.
  async syncSmartlane() {
    const response = await fetch(`${apiConfig.baseUrl}${SMARTLANE_BASE}/sync/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to sync with Smartlane");
    return data;
  }

  async getSmartlaneWarehouses() {
    const response = await fetch(`${apiConfig.baseUrl}${SMARTLANE_BASE}/warehouses/`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to load warehouses");
    return data;
  }

  async disconnectSmartlane() {
    const response = await fetch(`${apiConfig.baseUrl}${SMARTLANE_BASE}/`, {
      method: "DELETE",
      headers: authService.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Failed to disconnect");
  }
}

export const integrationsService = new IntegrationsService();
export default integrationsService;
