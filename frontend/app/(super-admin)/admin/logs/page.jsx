"use client";

import { useCallback, useEffect, useState } from "react";
import LogsTabs from "../../../../components/logs/LogsTabs";
import activityLogsAdminService from "../../../../services/activityLogsAdminService";
import tenantsService from "../../../../services/tenantsService";

// Every store's changes - pick one store or see them all.
export default function AdminLogsPage() {
  const [stores, setStores] = useState([]);

  useEffect(() => {
    tenantsService
      .listOrganizations()
      .then((data) => setStores(data.organizations || []))
      .catch(() => setStores([]));
  }, []);

  const fetchLogs = useCallback((params) => activityLogsAdminService.list(params), []);
  const fetchOrderLogs = useCallback((params) => activityLogsAdminService.orderLogs(params), []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Logs</h1>
      <LogsTabs fetchLogs={fetchLogs} fetchOrderLogs={fetchOrderLogs} stores={stores} />
    </div>
  );
}
