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

class FinanceService {
  // Invoices FynkTech issues for dispatching this store's orders - issued/
  // paid only, a draft is FynkTech's own working document.
  async listInvoices() {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.finance.invoices}`);
    return data.invoices || [];
  }

  async getInvoice(id) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.finance.invoice(id)}`);
    return data.invoice;
  }

  // Opened synchronously (before the await inside) so popup blockers,
  // which only allow window.open from a direct click handler, don't catch
  // it - same pattern as invoicesAdminService.openPrint.
  async openInvoicePrint(id) {
    const tab = window.open("", "_blank");
    try {
      const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.finance.invoicePrint(id)}`, {
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

  // null until the store has saved bank details for the first time.
  async getBankDetails() {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.finance.bankDetails}`);
    return data.bank_details;
  }

  async saveBankDetails({ accountTitle, bankName, accountNumber, iban, branchCode }) {
    const data = await request(`${apiConfig.baseUrl}${API_ENDPOINTS.finance.bankDetails}`, {
      method: "PUT",
      body: JSON.stringify({
        account_title: accountTitle,
        bank_name: bankName,
        account_number: accountNumber,
        iban,
        branch_code: branchCode,
      }),
    });
    return data.bank_details;
  }
}

export const financeService = new FinanceService();
export default financeService;
