"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "../../../lib/supabaseClient";
import Button from "../../../components/shared/Button";
import Modal from "../../../components/shared/Modal";
import PasswordInput from "../../../components/shared/PasswordInput";
import GreenTick from "../../../components/shared/GreenTick";
import { STAFF_MODULE_OPTIONS } from "../../../components/layout/moduleNav";
import teamService from "../../../services/teamService";
import storesService from "../../../services/storesService";
import { invalidateViewCache } from "../../../lib/viewCache";
import { useEffectiveUser } from "../../../store/authStore";
import { useBankDetailsGate } from "../../../lib/useBankDetailsGate";
import BankDetailsModal from "../../../components/billing/BankDetailsModal";

import { formatDate } from "../../../lib/formatDate";
function AccountTab({ user }) {
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  async function onChangeEmail(e) {
    e.preventDefault();
    setEmailError("");
    setEmailStatus("");
    setEmailLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw new Error(error.message);
      setEmailStatus(
        "Confirmation email sent - your login email won't change until you click the link Supabase just sent you."
      );
      setEmail("");
    } catch (err) {
      setEmailError(err.message || "Failed to change email");
    } finally {
      setEmailLoading(false);
    }
  }

  async function onChangePassword(e) {
    e.preventDefault();
    setPasswordError("");
    setPasswordStatus("");
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setPasswordLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setPasswordStatus("Password updated.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err.message || "Failed to change password");
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <p className="text-sm text-slate-500">Signed in as {user?.email}</p>

      <div className="rounded-lg border border-surface-border bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Change email</h2>
        {emailError ? (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{emailError}</p>
        ) : null}
        {emailStatus ? (
          <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {emailStatus}
          </p>
        ) : null}
        <form onSubmit={onChangeEmail} className="mt-3 flex gap-2">
          <input
            required
            type="email"
            placeholder="new-email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <Button type="submit" loading={emailLoading}>
            Update email
          </Button>
        </form>
      </div>

      <div className="rounded-lg border border-surface-border bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
        {passwordError ? (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {passwordError}
          </p>
        ) : null}
        {passwordStatus ? (
          <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {passwordStatus}
          </p>
        ) : null}
        <form onSubmit={onChangePassword} className="mt-3 space-y-3">
          <PasswordInput
            required
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordInput
            required
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button type="submit" loading={passwordLoading}>
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}

const LEVEL_OPTIONS = [
  { value: "", label: "None" },
  { value: "read", label: "Read" },
  { value: "write", label: "Read + Write" },
];

// The old way a staff login was given access (before roles) - shown for a
// login that somehow still has no role.
function moduleLabels(modules) {
  const keys = modules || [];
  if (!keys.length) return "No Access";
  return keys
    .map((key) => STAFF_MODULE_OPTIONS.find((o) => o.key === key)?.label || key)
    .join(", ");
}

// What a login can do, picked right on the Team form: tap a module (OMS,
// IMS, WMS, ...) and its pages open below it - each None / Read / Read +
// Write.
function AccessPicker({ catalog, value, onChange }) {
  const granted = value || {};
  const moduleOn = (module) => module.pages.some((p) => granted[p.key]);

  function toggleModule(module) {
    const next = { ...granted };
    if (moduleOn(module)) module.pages.forEach((p) => delete next[p.key]);
    else module.pages.forEach((p) => (next[p.key] = "write"));
    onChange(next);
  }

  function setPage(pageKey, level) {
    const next = { ...granted };
    if (level) next[pageKey] = level;
    else delete next[pageKey];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {catalog.map((module) => {
          const on = moduleOn(module);
          return (
            <button
              key={module.key}
              type="button"
              onClick={() => toggleModule(module)}
              aria-pressed={on}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                on
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-surface-border bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {module.label}
            </button>
          );
        })}
      </div>

      {catalog.filter(moduleOn).map((module) => (
        <div key={module.key} className="overflow-hidden rounded-md border border-surface-border">
          <div className="bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {module.label}
          </div>
          <ul className="divide-y divide-surface-border">
            {module.pages.map((page) => {
              const level = granted[page.key] || "";
              return (
                <li key={page.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-slate-700">{page.label}</span>
                  <span className="inline-flex overflow-hidden rounded-md border border-surface-border">
                    {LEVEL_OPTIONS.map((o) => (
                      <button
                        key={o.value || "none"}
                        type="button"
                        onClick={() => setPage(page.key, o.value)}
                        aria-pressed={level === o.value}
                        className={`px-3 py-1 text-xs font-medium transition ${
                          level === o.value
                            ? o.value
                              ? "bg-brand-600 text-white"
                              : "bg-slate-200 text-slate-700"
                            : "bg-white text-slate-500 hover:bg-surface"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!catalog.some(moduleOn) ? (
        <p className="text-xs text-slate-500">Tap a module to pick which of its pages this login can open.</p>
      ) : null}
    </div>
  );
}

// The Access column: one small badge per page - Read-only ones lighter.
function AccessBadges({ access, catalog, oldModules }) {
  if (!access) {
    return <span className="text-xs text-slate-500">Old Access · {moduleLabels(oldModules)}</span>;
  }
  const badges = [];
  catalog.forEach((module) =>
    module.pages.forEach((page) => {
      const level = access[page.key];
      if (!level) return;
      const name =
        module.key === "general" || module.label === page.label ? page.label : `${module.label} ${page.label}`;
      badges.push({ key: page.key, name, read: level === "read" });
    })
  );
  if (!badges.length) return <span className="text-xs text-slate-400">No Access</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span
          key={b.key}
          title={b.read ? "Read only" : "Read + Write"}
          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
            b.read ? "bg-slate-100 text-slate-600" : "bg-brand-50 text-brand-700"
          }`}
        >
          {b.name}
          {b.read ? " · Read" : ""}
        </span>
      ))}
    </div>
  );
}

// Settings → Team (store admin): staff logins - username (on the store's
// domain), password, and the pages they can open (AccessPicker).
function TeamTab() {
  const [members, setMembers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [emailDomain, setEmailDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [invite, setInvite] = useState({ username: "", password: "", permissions: {} });
  const [inviting, setInviting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ username: "", password: "", permissions: {} });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const team = await teamService.listMembers();
      setMembers(team.members || []);
      setEmailDomain(team.email_domain || "");
      setCatalog(team.pages || []);
    } catch (err) {
      setError(err.message || "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onInvite(e) {
    e.preventDefault();
    if (!Object.keys(invite.permissions).length) {
      setError("Pick at least one page this login can open");
      return;
    }
    setInviting(true);
    setError("");
    setSuccess("");
    try {
      const created = await teamService.inviteMember(invite);
      setInvite({ username: "", password: "", permissions: {} });
      const login = created?.member?.email || `${invite.username}@${emailDomain}`;
      setSuccess(`Team Member Added. Login: ${login}`);
      await load();
    } catch (err) {
      setError(err.message || "Failed to add");
    } finally {
      setInviting(false);
    }
  }

  function openEdit(member) {
    const username = member.username || (member.email || "").split("@")[0] || "";
    setEditingId(member.user_id);
    setEditForm({ username, originalUsername: username, password: "", permissions: { ...(member.access || {}) } });
    setError("");
    setSuccess("");
  }

  async function onSaveMember(member) {
    if (!Object.keys(editForm.permissions).length) {
      setError("Pick at least one page this login can open");
      return;
    }
    const payload = {};
    if (JSON.stringify(editForm.permissions) !== JSON.stringify(member.access || {})) {
      payload.permissions = editForm.permissions;
    }
    // Only when edited - re-sending it rebuilds the login as
    // username@org-domain, which would undo an email the member changed
    // themselves from their Account tab.
    if (editForm.username && editForm.username !== editForm.originalUsername) payload.username = editForm.username;
    if (editForm.password) payload.password = editForm.password;
    if (!Object.keys(payload).length) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await teamService.updateMember(member.user_id, payload);
      setEditingId(null);
      setSuccess("Staff Updated. New access applies on their next page change.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(userId) {
    if (!window.confirm("Click to confirm")) return;
    setError("");
    setSuccess("");
    try {
      await teamService.removeMember(userId);
      setSuccess("Member Removed.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to remove");
    }
  }

  const domainSuffix = emailDomain ? `@${emailDomain}` : "";
  const editingMember = members.find((m) => m.user_id === editingId) || null;

  return (
    <div className="max-w-5xl space-y-6">
      <p className="text-sm text-slate-500">
        Staff logins use your org domain
        {domainSuffix ? (
          <>
            {" "}
            (<span className="font-medium text-slate-700">{domainSuffix}</span>)
          </>
        ) : null}
        , so the same username in another organization cannot conflict.
      </p>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {success ? <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p> : null}

      <form onSubmit={onInvite} className="space-y-4 rounded-lg border border-surface-border bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Add Team Member</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Username</span>
            <div className="flex overflow-hidden rounded-md border border-surface-border focus-within:border-brand-500">
              <input
                required
                autoComplete="off"
                placeholder="sufyan"
                value={invite.username}
                onChange={(e) =>
                  setInvite((f) => ({ ...f, username: e.target.value.replace(/@.*$/, "").toLowerCase() }))
                }
                className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
              />
              {domainSuffix ? (
                <span className="flex items-center bg-slate-50 px-3 text-sm text-slate-500">{domainSuffix}</span>
              ) : null}
            </div>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Password</span>
            <PasswordInput
              required
              minLength={8}
              placeholder="Password (min 8)"
              value={invite.password}
              onChange={(e) => setInvite((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Access</p>
          <AccessPicker
            catalog={catalog}
            value={invite.permissions}
            onChange={(permissions) => setInvite((f) => ({ ...f, permissions }))}
          />
        </div>
        <Button type="submit" loading={inviting}>
          Add
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Organization Users</h2>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading…</p>
        ) : members.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No staff members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left">#</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left">Login</th>
                  <th className="px-4 py-2.5 text-left">Access</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left">Added On</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.user_id} className="border-b border-surface-border align-top last:border-0 hover:bg-surface/60">
                    <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{m.email || m.user_id}</td>
                    <td className="px-4 py-3">
                      <AccessBadges access={m.access} catalog={catalog} oldModules={m.allowed_modules} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {m.created_at ? formatDate(m.created_at) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => openEdit(m)}>
                          Edit
                        </Button>
                        <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => onRemove(m.user_id)}>
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingMember ? (
        <Modal
          open
          onClose={() => setEditingId(null)}
          title={`Edit ${editingMember.email || "Login"}`}
          width="max-w-2xl"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button type="button" loading={saving} onClick={() => onSaveMember(editingMember)}>
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Username</span>
                <div className="flex overflow-hidden rounded-md border border-surface-border focus-within:border-brand-500">
                  <input
                    value={editForm.username}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, username: e.target.value.replace(/@.*$/, "").toLowerCase() }))
                    }
                    className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
                  />
                  {domainSuffix ? (
                    <span className="flex items-center bg-slate-50 px-3 text-sm text-slate-500">{domainSuffix}</span>
                  ) : null}
                </div>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">New Password (Optional)</span>
                <PasswordInput
                  minLength={8}
                  placeholder="Leave blank to keep current"
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                />
              </label>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Access</p>
              <AccessPicker
                catalog={catalog}
                value={editForm.permissions}
                onChange={(permissions) => setEditForm((f) => ({ ...f, permissions }))}
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function StoresTab() {
  const router = useRouter();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(""); // "" | "manual" | "shopify"
  const [manualName, setManualName] = useState("");
  const [shopifyName, setShopifyName] = useState("");
  const [switchingId, setSwitchingId] = useState("");
  const { requireBankDetails, modalProps } = useBankDetailsGate();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStores(await storesService.list());
    } catch (err) {
      setError(err.message || "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function enterStore(id) {
    setSwitchingId(id);
    setError("");
    try {
      await storesService.switchTo(id);
      invalidateViewCache();
      router.push("/dashboard");
    } catch (err) {
      setError(err.message || "Could not switch store");
    } finally {
      setSwitchingId("");
    }
  }

  async function doCreateManual() {
    setError("");
    setCreating("manual");
    try {
      const store = await storesService.create({ name: manualName, isManualStore: true });
      setManualName("");
      await storesService.switchTo(store.id);
      invalidateViewCache();
      router.push("/orders");
    } catch (err) {
      setError(err.message || "Could not create the store");
      setCreating("");
    }
  }

  async function doCreateShopify() {
    setError("");
    setCreating("shopify");
    try {
      const store = await storesService.create({ name: shopifyName, isManualStore: false });
      setShopifyName("");
      await storesService.switchTo(store.id);
      invalidateViewCache();
      router.push("/integrations/shopify");
    } catch (err) {
      setError(err.message || "Could not create the store");
      setCreating("");
    }
  }

  function onCreateManual(e) {
    e.preventDefault();
    requireBankDetails(doCreateManual);
  }

  function onCreateShopify(e) {
    e.preventDefault();
    requireBankDetails(doCreateShopify);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-slate-500">
        One login, several stores - switch between them from the header any time.
      </p>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Your stores</h2>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading…</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {stores.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-2">
                  {store.is_current ? <GreenTick /> : <span className="h-4 w-4 shrink-0" />}
                  <div>
                    <p className="font-medium text-slate-900">{store.name}</p>
                    <p className="text-xs text-slate-500">
                      {store.is_manual_store ? "Manual store (CSV import)" : "Shopify / integrations"}
                      {!store.is_active ? " · Suspended" : ""}
                    </p>
                  </div>
                </div>
                {!store.is_current ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={switchingId === store.id}
                    disabled={!store.is_active}
                    onClick={() => enterStore(store.id)}
                  >
                    Switch
                  </Button>
                ) : (
                  <span className="text-xs font-medium text-brand-700">Current</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={onCreateShopify}
        className="space-y-3 rounded-lg border border-surface-border bg-white p-6"
      >
        <h2 className="text-sm font-semibold text-slate-900">Connect another Shopify store</h2>
        <p className="text-sm text-slate-500">
          Creates a new store under this same login, then takes you to connect its Shopify.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            required
            placeholder="Store name"
            value={shopifyName}
            onChange={(e) => setShopifyName(e.target.value)}
            className="min-w-[14rem] flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <Button type="submit" loading={creating === "shopify"}>
            Create &amp; connect Shopify
          </Button>
        </div>
      </form>

      <form
        onSubmit={onCreateManual}
        className="space-y-3 rounded-lg border border-surface-border bg-white p-6"
      >
        <h2 className="text-sm font-semibold text-slate-900">Create manual store</h2>
        <p className="text-sm text-slate-500">
          No Shopify needed - this store's orders come in by importing a CSV from its Orders page.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            required
            placeholder="Store name"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            className="min-w-[14rem] flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <Button type="submit" variant="secondary" loading={creating === "manual"}>
            Create manual store
          </Button>
        </div>
      </form>

      <BankDetailsModal {...modalProps} />
    </div>
  );
}

const SETTINGS_TABS = [
  { key: "account", label: "Account" },
  { key: "stores", label: "Stores", adminOnly: true },
  { key: "team", label: "Team", adminOnly: true },
];

export default function SettingsPage() {
  const user = useEffectiveUser();
  // Stores, staff logins and roles: the store admin only.
  const isOrgAdmin = user?.role === "org_admin" || user?.isOrgAdmin === true;
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    const asked = searchParams.get("tab") || "account";
    return asked === "rbac" || asked === "roles" ? "team" : asked;
  });
  const tabs = SETTINGS_TABS.filter((t) => !t.adminOnly || isOrgAdmin);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
      <div className="mt-4 flex gap-1 border-b border-surface-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-brand-600 text-brand-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "account" ? <AccountTab user={user} /> : null}
        {tab === "stores" && isOrgAdmin ? <StoresTab /> : null}
        {tab === "team" && isOrgAdmin ? <TeamTab /> : null}
      </div>
    </div>
  );
}
