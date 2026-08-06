const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5001";

export const apiConfig = {
  baseUrl: API_BASE_URL,
  timeoutMs: 30000,
};

export default apiConfig;
