import apiConfig from "../config/apiConfig";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import authService from "./authService";

// A store's Receivings page - OMS, below Critical Orders (backend
// oms/receivings_api.py): load sheet / return / inventory receiving
// pictures, kept in Bunny. An organization's stores share them.
async function request(url, options = {}) {
  const headers = { ...authService.getAuthHeaders(), ...(options.headers || {}) };
  // A file upload (FormData) must go without Content-Type, so the browser
  // sets multipart with its boundary. getAuthHeaders' "application/json"
  // used to be put back here, and the server read the pictures as JSON:
  // "JSON parse error - 'utf-8' codec can't decode byte 0xff" (2026-11-23).
  if (options.body instanceof FormData) delete headers["Content-Type"];
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.detail || "Request failed");
  }
  return data;
}

const receivingsService = {
  // {receivings, counts, couriers, grouped}
  list(kind = "") {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.receivings}${qs}`);
  },

  // files: File[] from the gallery picker. Answers {receiving}.
  create({ kind, courier, receivedOn, note, files }) {
    const form = new FormData();
    form.append("kind", kind);
    form.append("courier", courier || "");
    form.append("received_on", receivedOn || "");
    form.append("note", note || "");
    files.forEach((file) => form.append("images", file, file.name));
    // No Content-Type: the browser sets the multipart boundary itself
    // (request() drops it for a FormData body).
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.receivings}`, { method: "POST", body: form });
  },

  remove(id) {
    return request(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.receiving(id)}`, { method: "DELETE" });
  },

  // The storage zone is private, so a picture is fetched with the login's
  // headers and shown from a blob: URL (revoke it when done).
  async imageUrl(id) {
    const response = await fetch(`${apiConfig.baseUrl}${API_ENDPOINTS.oms.receivingImage(id)}`, {
      headers: authService.getAuthHeaders(),
    });
    if (!response.ok) throw new Error("Couldn't load the picture");
    return URL.createObjectURL(await response.blob());
  },
};

export default receivingsService;
