"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import LogsTabs from "../../../components/logs/LogsTabs";
import teamService from "../../../services/teamService";
import useAuthStore, { useEffectiveUser } from "../../../store/authStore";

export default function LogsPage() {
  const router = useRouter();
  const user = useEffectiveUser();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isOrgAdmin = user?.role === "org_admin" || user?.isOrgAdmin === true;

  useEffect(() => {
    if (!hydrated) return;
    if (!isOrgAdmin) router.replace("/settings");
  }, [hydrated, isOrgAdmin, router]);

  const fetchLogs = useCallback((params) => teamService.listAuditLogs(params), []);
  const fetchOrderLogs = useCallback((params) => teamService.orderLogs(params), []);

  if (!hydrated || !isOrgAdmin) {
    return <p className="text-sm text-slate-500">Checking access…</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Logs</h1>
      <LogsTabs fetchLogs={fetchLogs} fetchOrderLogs={fetchOrderLogs} />
    </div>
  );
}
