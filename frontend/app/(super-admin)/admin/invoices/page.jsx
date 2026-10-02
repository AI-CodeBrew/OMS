"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import invoicesAdminService from "../../../../services/invoicesAdminService";
import tenantsService from "../../../../services/tenantsService";
import Button from "../../../../components/shared/Button";

const STATUS_TONE = {
  draft: "bg-slate-100 text-slate-600",
  issued: "bg-sky-50 text-sky-700",
  paid: "bg-emerald-50 text-emerald-700",
  void: "bg-red-50 text-red-700",
};

function todayMinus(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function InvoicesAdminPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");

  const [genOrgId, setGenOrgId] = useState("");
  const [genStart, setGenStart] = useState(todayMinus(30));
  const [genEnd, setGenEnd] = useState(todayMinus(0));
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, orgs] = await Promise.all([
        invoicesAdminService.list({ organizationId: storeFilter, status: statusFilter }),
        stores.length ? Promise.resolve({ organizations: stores }) : tenantsService.listOrganizations(),
      ]);
      setInvoices(list);
      if (!stores.length) setStores(orgs.organizations || []);
    } catch (err) {
      setError(err.message || "Failed to load invoices");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function onGenerate(e) {
    e.preventDefault();
    if (!genOrgId) return;
    setGenerating(true);
    setError("");
    try {
      const invoice = await invoicesAdminService.generate({
        organizationId: genOrgId,
        periodStart: genStart,
        periodEnd: genEnd,
      });
      router.push(`/admin/invoices/${invoice.id}`);
    } catch (err) {
      setError(err.message || "Could not generate the invoice");
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bill a store for dispatching its orders - generate a draft, adjust it, then issue.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <form
        onSubmit={onGenerate}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-surface-border bg-white p-5"
      >
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Store</span>
          <select
            value={genOrgId}
            onChange={(e) => setGenOrgId(e.target.value)}
            className="min-w-[14rem] rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Select a store…</option>
            {stores.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Period start</span>
          <input
            type="date"
            value={genStart}
            onChange={(e) => setGenStart(e.target.value)}
            className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Period end</span>
          <input
            type="date"
            value={genEnd}
            onChange={(e) => setGenEnd(e.target.value)}
            className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <Button type="submit" disabled={!genOrgId} loading={generating}>
          Generate draft
        </Button>
      </form>

      <div className="flex flex-wrap gap-3">
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">All stores</option>
          {stores.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-sm text-slate-500">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-surface/60"
              >
                <button
                  type="button"
                  onClick={() => router.push(`/admin/invoices/${inv.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate font-medium text-slate-900">
                    {inv.number || "Draft"} · {inv.store_name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {inv.period_start} – {inv.period_end} · Rs {inv.total}
                  </p>
                </button>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                    STATUS_TONE[inv.status] || STATUS_TONE.draft
                  }`}
                >
                  {inv.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
