"use client";

import { useEffect, useState } from "react";
import healthService from "../../../services/healthService";

export default function OrdersPage() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await healthService.getProtectedHealth();
        if (!cancelled) setHealth(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Orders</h1>
      <p className="mt-1 text-sm text-slate-500">
        Order module scaffolding — authenticated API session verified below.
      </p>
      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {health ? (
        <div className="mt-4 rounded-lg border border-surface-border bg-white p-4 text-sm text-slate-700">
          <p>
            API: <span className="font-medium text-green-700">{health.status}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            user={health.user_id} · tenant={health.tenant_id || "—"} · role=
            {health.role}
          </p>
        </div>
      ) : null}
    </div>
  );
}
