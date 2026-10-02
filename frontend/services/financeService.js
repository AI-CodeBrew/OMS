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
  // Invoices FynkTech issues for dispatching this store's orders. Stubbed
  // out until Phase 5 (super admin issuing) exists on the backend.
  async listInvoices() {
    return [];
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
