"use client";

import { useCallback } from "react";
import OrderLogsBrowser from "../../../../components/logs/OrderLogsBrowser";
import activityLogsAdminService from "../../../../services/activityLogsAdminService";

// The last order updates over every store, or - searched - one order's
// whole log: what happened, when, and who did it.
export default function AdminLogsPage() {
  const fetchLogs = useCallback((params) => activityLogsAdminService.list(params), []);
  const fetchOrderLogs = useCallback((params) => activityLogsAdminService.orderLogs(params), []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Logs</h1>
      <OrderLogsBrowser fetchLogs={fetchLogs} fetchOrderLogs={fetchOrderLogs} />
    </div>
  );
}
