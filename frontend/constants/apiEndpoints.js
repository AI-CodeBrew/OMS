export const API_ENDPOINTS = {
  health: "/api/v1/health",
  healthProtected: "/api/v1/health/protected",
  auth: {
    login: "/api/v1/auth/login",
    me: "/api/v1/auth/me",
  },
  // Added as modules land:
  // tenants, orders, confirmation, ops, wms, returns, finance
};

export default API_ENDPOINTS;
