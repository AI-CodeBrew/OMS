"use client";

import { useCallback } from "react";
import OrderLogsBrowser from "../../../../components/logs/OrderLogsBrowser";
import activityLogsAdminService from "../../../../services/activityLogsAdminService";

// Every store's orders, filtered like All Orders - open one to see its
// whole history: what happened, when, and who did it.
export default function AdminLogsPage() {
  const fetchOrderLogs = useCallback((params) => activityLogsAdminService.orderLogs(params), []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Logs</h1>
      <OrderLogsBrowser fetchOrderLogs={fetchOrderLogs} />
    </div>
  );
}
