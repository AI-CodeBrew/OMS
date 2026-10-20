"use client";

import { useCallback, useEffect, useState } from "react";
import ActivityLog from "../../../../components/logs/ActivityLog";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Logs</h1>
        <p className="mt-1 text-sm text-slate-500">
          What changed, when, and who changed it - in every store. Click an order&apos;s log to see
          its full history.
        </p>
      </div>
      <ActivityLog fetchLogs={fetchLogs} stores={stores} />
    </div>
  );
}
