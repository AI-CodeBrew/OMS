"use client";

import { useEffect, useState } from "react";
import healthService from "../../../services/healthService";

export default function SystemHealthPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await healthService.getProtectedHealth();
        if (!cancelled) setResult(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">System health</h1>
      <p className="mt-1 text-sm text-slate-500">
        Authenticated probe of the Flask API
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Checking…</p>
      ) : null}
      {error ? (
        <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {result ? (
        <pre className="mt-6 overflow-auto rounded-lg border border-surface-border bg-white p-4 text-xs text-slate-700">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
