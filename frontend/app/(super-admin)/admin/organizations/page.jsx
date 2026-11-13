"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "../../../../components/shared/Button";
import PasswordInput from "../../../../components/shared/PasswordInput";
import tenantsService from "../../../../services/tenantsService";
import { useRememberedData } from "../../../../lib/pageMemory";

const EMPTY_CREATE = {
  name: "",
  email: "",
  password: "",
  plan: "starter",
};

export default function OrganizationsPage() {
  const router = useRouter();
  // Back shows the last loaded list at once while a fresh one loads.
  const { recall, remember } = useRememberedData("organizations");
  const [organizations, setOrganizations] = useState(() => recall() || []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATE);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await tenantsService.listOrganizations();
      setOrganizations(data.organizations || []);
      remember(data.organizations || []);
    } catch (err) {
      setError(err.message || "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }, [remember]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const data = await tenantsService.createOrganization({
        name: form.name,
        email: form.email,
        password: form.password,
        plan: form.plan,
        modules: ["oms", "ims", "wms"],
      });
      const id = data.organization?.id;
      setForm(EMPTY_CREATE);
      setShowCreate(false);
      if (id) {
        router.push(`/admin/organizations/${id}`);
        return;
      }
      await load();
    } catch (err) {
      setError(err.message || "Failed to create organization");
    } finally {
      setCreating(false);
    }
  }

  async function onToggleSuspend(org) {
    const suspending = org.is_active;
    if (
      suspending &&
      !window.confirm(
        `Suspend ${org.name}? Its users won't be able to sign in or use the app until you ` +
          `reactivate it.`,
      )
    ) {
      return;
    }
    setBusyId(org.id);
    setError("");
    setSuccess("");
    try {
      await tenantsService.setOrganizationActive(org.id, !suspending);
      setSuccess(suspending ? `${org.name} is suspended.` : `${org.name} is active again.`);
      await load();
    } catch (err) {
      setError(err.message || "Failed to update organization");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Organizations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create tenants and open one to manage its details.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New organization"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>
      ) : null}

      {showCreate ? (
        <form
          onSubmit={onCreate}
          className="space-y-4 rounded-xl border border-surface-border bg-white p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-slate-900">New organization</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">
                Organization name
              </span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Plan</span>
              <select
                value={form.plan}
                onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}
                className="w-full rounded-lg border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">
                Admin login email
              </span>
              <input
                type="email"
                required
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">
                Admin password
              </span>
              <PasswordInput
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Creates a Supabase login for this org. They sign in at /login.
          </p>
          <Button type="submit" loading={creating}>
            Create organization
          </Button>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        {loading && organizations.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-500">Loading organizations…</p>
        ) : organizations.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-slate-800">No organizations yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Create one to provision the first tenant login.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Org Name</th>
                  <th className="px-4 py-3">Store ID</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">No. of Stores</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {organizations.map((org) => {
                  const stores = org.stores || [];
                  const busy = busyId === org.id;
                  return (
                    <tr key={org.id} className="transition hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/organizations/${org.id}`}
                          className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                        >
                          {org.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {stores.length ? (
                          <span title={stores.map((st) => `${st.store_id} - ${st.name}`).join(", ")}>
                            {stores.map((st) => st.store_id).join(", ")}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            org.is_active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                          }`}
                        >
                          {org.is_active ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{stores.length}</td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant={org.is_active ? "danger" : "secondary"}
                          onClick={() => onToggleSuspend(org)}
                          loading={busy}
                        >
                          {org.is_active ? "Suspend" : "Reactivate"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
