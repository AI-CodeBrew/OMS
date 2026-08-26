export const API_ENDPOINTS = {
  health: "/api/core/health/",
  healthProtected: "/api/core/health/protected/",
  oms: {
    orders: "/api/oms/orders/",
    orderCounts: "/api/oms/orders/counts/",
    orderDashboard: "/api/oms/orders/dashboard/",
    orderReturnsSummary: "/api/oms/orders/returns-summary/",
    orderBulkAction: "/api/oms/orders/bulk-action/",
    orderScanDispatch: "/api/oms/orders/scan-dispatch/",
    orderScanReturn: "/api/oms/orders/scan-return/",
    orderExport: "/api/oms/orders/export/",
    couriers: "/api/oms/couriers/",
    order: (id) => `/api/oms/orders/${id}/`,
    orderNotes: (id) => `/api/oms/orders/${id}/notes/`,
    orderTransactions: (id) => `/api/oms/orders/${id}/transactions/`,
    orderLog: (id) => `/api/oms/orders/${id}/log/`,
    orderCustomerHistory: (id) => `/api/oms/orders/${id}/customer-history/`,
    orderSplitOrders: (id) => `/api/oms/orders/${id}/split-orders/`,
    orderSplit: (id) => `/api/oms/orders/${id}/split/`,
    orderLoadsheet: (id) => `/api/oms/orders/${id}/loadsheet/`,
    orderAirwayBill: (id) => `/api/oms/orders/${id}/airway-bill/`,
  },
  wms: {
    warehouses: "/api/wms/warehouses/",
    stock: "/api/wms/stock/",
    stockSummary: "/api/wms/stock/summary/",
    stockAdjust: (id) => `/api/wms/stock/${id}/adjust/`,
    stockImportSkus: "/api/wms/stock/import-skus/",
    movements: "/api/wms/movements/",
    returnScan: "/api/wms/returns/scan/",
  },
  // Added as modules land: finance
};

export default API_ENDPOINTS;
