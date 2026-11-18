import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

// The super admin side's Receivings page (backend oms.receivings_admin):
// load sheet / return / inventory receiving pictures, kept in Bunny.
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...authService.getAuthHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.detail || "Request failed");
  }
  return data;
}

const receivingsAdminService = {
  // {receivings, counts, couriers}
  list(kind = "") {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.receivings}${qs}`);
  },

  // files: File[] from the gallery picker. Answers {receiving}.
  create({ kind, courier, receivedOn, note, files }) {
    const form = new FormData();
    form.append("kind", kind);
    form.append("courier", courier || "");
    form.append("received_on", receivedOn || "");
    form.append("note", note || "");
    files.forEach((file) => form.append("images", file, file.name));
    // No Content-Type: the browser sets the multipart boundary itself.
    const headers = { ...authService.getAuthHeaders() };
    delete headers["Content-Type"];
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.receivings}`, { method: "POST", body: form, headers });
  },

  remove(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.receiving(id)}`, { method: "DELETE" });
  },

  // The storage zone is private, so a picture is fetched with the login's
  // headers and shown from a blob: URL (revoke it when done).
  async imageUrl(id) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.admin.receivingImage(id)}`, {
      headers: authService.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Couldn't load the picture");
    return URL.createObjectURL(await response.blob());
  },
};

export default receivingsAdminService;
