"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Button from "../../../../../components/shared/Button";
import PasswordInput from "../../../../../components/shared/PasswordInput";
import tenantsService from "../../../../../services/tenantsService";

import { formatDateTime } from "../../../../../lib/formatDate";
function moduleLabel(modules) {
  const list = modules || [];
  if (!list.length) return "no modules";
  return list.map((m) => (m === "returns" ? "returns associate" : m)).join(", ");
}

function MemberRow({ member, isStaff, onEdit }) {
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${
        isStaff ? "bg-slate-50/70 pl-10" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        {isStaff ? (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden />
        ) : null}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{member.email || member.user_id}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                member.role === "org_admin"
                  ? "bg-brand-50 text-brand-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {member.role === "org_admin" ? "Admin" : "Staff"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {member.role === "org_admin"
              ? "Organization admin · all enabled modules"
              : `Modules · ${moduleLabel(member.allowed_modules)}`}
          </p>
        </div>
      </div>
      <Button type="button" variant="secondary" onClick={() => onEdit(member)}>
        Reset / change email
      </Button>
    </li>
  );
}

// The stores inside this organization (one main store, others inside it).
// They keep their own orders, Shopify and couriers; they share one
// inventory and the main store's admins can open all of them.
function OrganizationStores({ org, onChanged }) {
  const [candidates, setCandidates] = useState([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isInside = Boolean(org.parent_id);
  const children = org.child_stores || [];

  useEffect(() => {
    if (isInside) return undefined;
    let alive = true;
    tenantsService
      .listOrganizations()
      .then((data) => {
        if (!alive) return;
        // Stores that can go inside: on their own, no stores inside them.
        setCandidates(
          (data.organizations || []).filter(
            (o) => o.id !== org.id && !o.parent_id && !(o.child_stores || []).length,
          ),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [org.id, isInside, children.length]);

  async function onAdd() {
    const store = candidates.find((c) => c.id === pick);
    if (!store) return;
    const message = [
      `Put ${store.name} inside ${org.name}?`,
      "",
      `- ${store.name} keeps its own orders, Shopify, couriers and Store ID.`,
      `- Its stock is merged into ${org.name}'s inventory (same SKU, else same name - quantities added) and its warehouses are retired.`,
      "- From then on both stores use ONE inventory. The OMS is the stock master: stock changes are pushed to both Shopify stores.",
      `- ${org.name}'s admins can open ${store.name}.`,
    ].join("\n");
    if (!window.confirm(message)) return;
    setBusy("add");
    setError("");
    setNotice("");
    try {
      const res = await tenantsService.addStoreToOrganization(org.id, store.id);
      const inv = res.inventory || {};
      setNotice(
        `${store.name} is now inside ${org.name}. Stock: ${inv.items_merged || 0} merged, ` +
          `${inv.items_moved || 0} moved over. Admin access added: ${res.admins_added || 0}.`,
      );
      setPick("");
      onChanged();
    } catch (err) {
      setError(err.message || "Could not add the store");
    } finally {
      setBusy("");
    }
  }

  async function onRemove(store) {
    const message = [
      `Take ${store.name} out of ${org.name}?`,
      "",
      `The shared inventory stays with ${org.name}; ${store.name} starts again with no stock of its own.`,
      "People keep the access they have.",
    ].join("\n");
    if (!window.confirm(message)) return;
    setBusy(store.id);
    setError("");
    setNotice("");
    try {
      await tenantsService.removeStoreFromOrganization(org.id, store.id);
      setNotice(`${store.name} is a separate organization again.`);
      onChanged();
    } catch (err) {
      setError(err.message || "Could not remove the store");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
      <div className="border-b border-surface-border px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Stores in this organization</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Each store keeps its own orders, Shopify and couriers. They share one inventory, and this
          organization&apos;s admins can open every store.
        </p>
      </div>
      {error ? <p className="mx-5 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? (
        <p className="mx-5 mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      ) : null}
      {isInside ? (
        <p className="px-5 py-5 text-sm text-slate-600">
          This store is inside{" "}
          <Link href={`/admin/organizations/${org.parent_id}`} className="font-medium text-brand-700 hover:underline">
            {org.parent_name}
          </Link>
          . Manage the organization&apos;s stores there.
        </p>
      ) : (
        <div className="space-y-4 px-5 py-5">
          <ul className="divide-y divide-surface-border rounded-lg border border-surface-border">
            <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-medium text-slate-900">{org.name}</span>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                Main store
              </span>
            </li>
            {children.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <Link
                  href={`/admin/organizations/${store.id}`}
                  className="text-slate-800 hover:text-brand-700 hover:underline"
                >
                  {store.name}
                </Link>
                <Button variant="secondary" loading={busy === store.id} onClick={() => onRemove(store)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">Add a store to this organization…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button loading={busy === "add"} disabled={!pick} onClick={onAdd}>
              Add store
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function OrganizationDetailPage() {
  const params = useParams();
  const orgId = params?.id;
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editMember, setEditMember] = useState(null);
  const [editForm, setEditForm] = useState({ email: "", password: "" });
  const [savingMember, setSavingMember] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const data = await tenantsService.getOrganization(orgId);
      setOrg(data.organization || null);
    } catch (err) {
      setError(err.message || "Failed to load organization");
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const { admins, staff } = useMemo(() => {
    const members = org?.members || [];
    return {
      admins: members.filter((m) => m.role === "org_admin"),
      staff: members.filter((m) => m.role !== "org_admin"),
    };
  }, [org]);

  function openEdit(member) {
    setEditMember(member);
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

  if (loading) {
    return <p className="text-sm text-slate-500">Loading organization…</p>;
  }

  if (!org) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Organization not found"}
        </p>
        <Link href="/admin/organizations" className="text-sm text-brand-600 hover:underline">
          ← Back to organizations
        </Link>
      </div>
    );
  }

  const modules = (org.modules || [])
    .filter((m) => m.is_enabled)
    .map((m) => m.module);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/organizations"
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          ← Organizations
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{org.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {org.slug} · {org.plan}
              {modules.length ? ` · ${modules.join(", ")}` : ""}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              org.is_active
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {org.is_active ? "Active" : "Suspended"}
          </span>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      {editMember ? (
        <form
          onSubmit={onSaveMember}
          className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/50 p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Edit user credentials
              </h2>
              <p className="mt-1 text-xs text-slate-500">{editMember.role}</p>
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
              <span className="mb-1.5 block font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, email: e.target.value }))
                }
                className="w-full rounded-lg border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">
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
          <Button type="submit" loading={savingMember}>
            Save credentials
          </Button>
        </form>
      ) : null}

      <OrganizationStores org={org} onChanged={load} />

      <section className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Organization team</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Admin first, then staff under that organization
          </p>
        </div>
        {admins.length === 0 && staff.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">No members linked.</p>
        ) : (
          <div>
            <div className="border-b border-surface-border bg-slate-50 px-5 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Admin
              </p>
            </div>
            {admins.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No org admin found.</p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {admins.map((member) => (
                  <MemberRow
                    key={member.user_id}
                    member={member}
                    isStaff={false}
                    onEdit={openEdit}
                  />
                ))}
              </ul>
            )}

            <div className="border-y border-surface-border bg-slate-50 px-5 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Staff
              </p>
            </div>
            {staff.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No staff members yet.</p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {staff.map((member) => (
                  <MemberRow
                    key={member.user_id}
                    member={member}
                    isStaff
                    onEdit={openEdit}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Shopify</h2>
        </div>
        {!org.shopify ? (
          <p className="px-5 py-8 text-sm text-slate-500">No Shopify connection on record.</p>
        ) : (
          <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Shop</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {org.shopify.shop_name || org.shopify.shop_domain || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Domain</dt>
              <dd className="mt-1 text-sm text-slate-900">{org.shopify.shop_domain || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Status</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {org.shopify.is_connected ? "Connected" : "Disconnected"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Last synced</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {org.shopify.last_synced_at
                  ? formatDateTime(org.shopify.last_synced_at)
                  : "Never"}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
