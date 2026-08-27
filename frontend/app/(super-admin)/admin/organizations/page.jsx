"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "../../../../components/shared/Button";
import PasswordInput from "../../../../components/shared/PasswordInput";
import tenantsService from "../../../../services/tenantsService";

const EMPTY_CREATE = {
  name: "",
  email: "",
  password: "",
  plan: "starter",
};

export default function OrganizationsPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATE);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await tenantsService.listOrganizations();
      setOrganizations(data.organizations || []);
    } catch (err) {
      setError(err.message || "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }, []);

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
        modules: ["oms", "wms"],
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
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create organization"}
          </Button>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-sm text-slate-500">Loading organizations…</p>
        ) : organizations.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-slate-800">No organizations yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Create one to provision the first tenant login.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-surface-border">
            {organizations.map((org) => {
              const memberCount = (org.members || []).length;
              const modules = (org.modules || [])
                .filter((m) => m.is_enabled)
                .map((m) => m.module);
              return (
                <li key={org.id}>
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{org.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {org.slug} · {org.plan}
                        {modules.length ? ` · ${modules.join(", ")}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          org.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {org.is_active ? "Active" : "Inactive"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {memberCount} {memberCount === 1 ? "user" : "users"}
                      </span>
                      <span className="text-sm text-brand-600">View →</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
