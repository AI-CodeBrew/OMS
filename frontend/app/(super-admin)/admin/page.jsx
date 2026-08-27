"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "../../../components/shared/Button";
import PasswordInput from "../../../components/shared/PasswordInput";
import tenantsService from "../../../services/tenantsService";

const EMPTY_CREATE = {
  name: "",
  email: "",
  password: "",
  plan: "starter",
};

export default function AdminPage() {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATE);
  const [editMember, setEditMember] = useState(null);
  const [editForm, setEditForm] = useState({ email: "", password: "" });
  const [savingMember, setSavingMember] = useState(false);

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
    setSuccess("");
    try {
      await tenantsService.createOrganization({
        name: form.name,
        email: form.email,
        password: form.password,
        plan: form.plan,
        modules: ["oms", "wms"],
      });
      setForm(EMPTY_CREATE);
      setShowCreate(false);
      setSuccess("Organization and login user created.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to create organization");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(member, org) {
    setEditMember({ ...member, organization_name: org.name });
    setEditForm({ email: member.email || "", password: "" });
    setError("");
    setSuccess("");
  }

  async function onSaveMember(e) {
    e.preventDefault();
    if (!editMember) return;
    setSavingMember(true);
    setError("");
    setSuccess("");
    try {
      const payload = {};
      if (editForm.email && editForm.email !== editMember.email) {
        payload.email = editForm.email;
      }
      if (editForm.password) {
        payload.password = editForm.password;
      }
      if (!payload.email && !payload.password) {
        setError("Enter a new email and/or password");
        setSavingMember(false);
        return;
      }
      await tenantsService.updateMember(editMember.user_id, payload);
      setEditMember(null);
      setSuccess("User credentials updated.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to update user");
    } finally {
      setSavingMember(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create organizations and manage their login users.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Close form" : "Add organization"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      {showCreate ? (
        <form
          onSubmit={onCreate}
          className="space-y-4 rounded-xl border border-surface-border bg-white p-6"
        >
          <h2 className="text-sm font-semibold text-slate-900">New organization</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Organization name
              </span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Plan</span>
              <select
                value={form.plan}
                onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Admin login email
              </span>
              <input
                type="email"
                required
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
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
            Creates a Supabase login for this org. They can sign in at /login with
            these credentials.
          </p>
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create organization"}
          </Button>
        </form>
      ) : null}

      {editMember ? (
        <form
          onSubmit={onSaveMember}
          className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/40 p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Edit user credentials
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {editMember.organization_name} · {editMember.role}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditMember(null)}
            >
              Cancel
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, email: e.target.value }))
                }
                className="w-full rounded-md border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                New password (optional)
              </span>
              <PasswordInput
                minLength={8}
                autoComplete="new-password"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Leave blank to keep current"
              />
            </label>
          </div>
          <Button type="submit" disabled={savingMember}>
            {savingMember ? "Saving…" : "Save credentials"}
          </Button>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white">
        <div className="border-b border-surface-border px-4 py-3 text-sm font-semibold text-slate-800">
          Organizations
        </div>
        {loading ? (
          <p className="px-4 py-8 text-sm text-slate-500">Loading…</p>
        ) : organizations.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">
            No organizations yet. Add one to create the first login.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {organizations.map((org) => (
              <li key={org.id} className="px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{org.name}</p>
                    <p className="text-xs text-slate-500">
                      {org.slug} · {org.plan} ·{" "}
                      {org.is_active ? "active" : "inactive"}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {(org.modules || [])
                      .filter((m) => m.is_enabled)
                      .map((m) => m.module)
                      .join(", ") || "no modules"}
                  </p>
                </div>
                <div className="mt-3 space-y-2">
                  {(org.members || []).length === 0 ? (
                    <p className="text-xs text-slate-500">No members linked.</p>
                  ) : (
                    (org.members || []).map((member) => (
                      <div
                        key={member.user_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="text-slate-800">
                            {member.email || member.user_id}
                          </p>
                          <p className="text-xs text-slate-500">{member.role}</p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => openEdit(member, org)}
                        >
                          Reset / change email
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
