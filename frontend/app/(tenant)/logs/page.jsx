"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../../../components/shared/Button";
import teamService from "../../../services/teamService";
import useAuthStore from "../../../store/authStore";

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LogsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const isOrgAdmin = user?.role === "org_admin" || user?.isOrgAdmin === true;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(toLocalInputValue(weekAgo));
  const [to, setTo] = useState(toLocalInputValue(now));
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hydrated) return;
    if (!isOrgAdmin) router.replace("/settings");
  }, [hydrated, isOrgAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const fromIso = from ? new Date(from).toISOString() : undefined;
      const toIso = to ? new Date(to).toISOString() : undefined;
      const data = await teamService.listAuditLogs({
        from: fromIso,
        to: toIso,
        page,
        pageSize: 50,
      });
      setRows(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load logs");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, page]);

  useEffect(() => {
    if (!isOrgAdmin) return;
    load();
  }, [isOrgAdmin, load]);

  if (!hydrated || !isOrgAdmin) {
    return <p className="text-sm text-slate-500">Checking access…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Audit logs</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who changed team access, orders, stock, and integrations.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-surface-border bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          load();
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">From</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-surface-border px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">To</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-surface-border px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" loading={loading}>
          Apply
        </Button>
      </form>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="border-b border-surface-border px-5 py-3 text-sm text-slate-500">
          {count} event{count === 1 ? "" : "s"}
        </div>
        {rows.length === 0 && !loading ? (
          <p className="px-5 py-8 text-sm text-slate-500">No audit events in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Who</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-800">{row.actor_email || row.actor_user_id || "—"}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">{row.action}</td>
                    <td className="px-5 py-3 text-slate-800">{row.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {count > 50 ? (
          <div className="flex items-center justify-between border-t border-surface-border px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-500">Page {page}</span>
            <Button
              type="button"
              variant="secondary"
              disabled={page * 50 >= count || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
