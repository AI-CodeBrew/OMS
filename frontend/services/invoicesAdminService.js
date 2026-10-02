import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authService.getAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

class InvoicesAdminService {
  async list({ organizationId, status } = {}) {
    const data = await request(
      `${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoices}${buildQuery({
        organization_id: organizationId,
        status,
      })}`
    );
    return data.invoices || [];
  }

  async generate({ organizationId, periodStart, periodEnd }) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoiceGenerate}`, {
      method: "POST",
      body: JSON.stringify({
        organization_id: organizationId,
        period_start: periodStart,
        period_end: periodEnd,
      }),
    });
    return data.invoice;
  }

  async get(id) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoice(id)}`);
    return data.invoice;
  }

  async saveLines(id, lines) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoice(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ lines }),
    });
    return data.invoice;
  }

  async saveNotes(id, { notes, dueDate }) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoice(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ notes, due_date: dueDate || null }),
    });
    return data.invoice;
  }

  async issue(id) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoiceIssue(id)}`, {
      method: "POST",
    });
    return data.invoice;
  }

  async markPaid(id) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoicePaid(id)}`, {
      method: "POST",
    });
    return data.invoice;
  }

  async voidInvoice(id) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoiceVoid(id)}`, {
      method: "POST",
    });
    return data.invoice;
  }

  // The print endpoint needs the same auth headers every other call here
  // does, so a plain <a href> can't hit it directly - fetch it and open
  // the HTML as a blob in a new tab instead (same reasoning as every
  // document download elsewhere in this app, see ordersService.js). The
  // tab is opened synchronously, before the await, so popup blockers
  // (which only allow window.open from a direct click handler) don't
  // catch it.
  async openPrint(id) {
    const tab = window.open("", "_blank");
    try {
      const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.invoicePrint(id)}`, {
        headers: authService.getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Could not open the invoice");
      const blob = await response.blob();
      if (tab) tab.location.href = window.URL.createObjectURL(blob);
    } catch (err) {
      tab?.close();
      throw err;
    }
  }
}

export const invoicesAdminService = new InvoicesAdminService();
export default invoicesAdminService;
