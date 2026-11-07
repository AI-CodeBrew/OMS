"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "../../../lib/supabaseClient";
import Button from "../../../components/shared/Button";
import PasswordInput from "../../../components/shared/PasswordInput";
import GreenTick from "../../../components/shared/GreenTick";
import { STAFF_MODULE_OPTIONS } from "../../../components/layout/moduleNav";
import teamService from "../../../services/teamService";
import storesService from "../../../services/storesService";
import { invalidateViewCache } from "../../../lib/viewCache";
import { useEffectiveUser } from "../../../store/authStore";
import { useBankDetailsGate } from "../../../lib/useBankDetailsGate";
import BankDetailsModal from "../../../components/billing/BankDetailsModal";

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

// One role's pages, as the Roles editor's grid: every module this store
// has, each page None / Read / Read + Write.
function PermissionGrid({ catalog, value, onChange }) {
  function set(pageKey, level) {
    const next = { ...(value || {}) };
    if (level) next[pageKey] = level;
    else delete next[pageKey];
    onChange(next);
  }
  function setModule(module, level) {
    const next = { ...(value || {}) };
    module.pages.forEach((p) => {
      if (level) next[p.key] = level;
      else delete next[p.key];
    });
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {catalog.map((module) => (
        <div key={module.key} className="overflow-hidden rounded-md border border-surface-border">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface px-3 py-2">
            <span className="text-sm font-semibold text-slate-800">{module.label}</span>
            <span className="flex gap-1 text-[11px]">
              {LEVEL_OPTIONS.map((o) => (
                <button
                  key={o.value || "none"}
                  type="button"
                  onClick={() => setModule(module, o.value)}
                  className="rounded border border-surface-border bg-white px-2 py-0.5 text-slate-600 hover:border-slate-300"
                  title={`Set every ${module.label} page to ${o.label}`}
                >
                  All {o.label}
                </button>
              ))}
            </span>
          </div>
          <ul className="divide-y divide-surface-border">
            {module.pages.map((page) => {
              const level = (value || {})[page.key] || "";
              return (
                <li key={page.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-slate-700">{page.label}</span>
                  <span className="inline-flex overflow-hidden rounded-md border border-surface-border">
                    {LEVEL_OPTIONS.map((o) => (
                      <button
                        key={o.value || "none"}
                        type="button"
                        onClick={() => set(page.key, o.value)}
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
    </div>
  );
}

function permissionSummary(permissions, catalog) {
  const labels = [];
  catalog.forEach((module) =>
    module.pages.forEach((page) => {
      const level = (permissions || {})[page.key];
      if (!level) return;
      // "Report", not "Other Report"; "Financify", not "Financify Financify".
      const name =
        module.key === "general" || module.label === page.label ? page.label : `${module.label} ${page.label}`;
      labels.push(`${name}${level === "read" ? " (Read)" : ""}`);
    })
  );
  return labels.length ? labels.join(" · ") : "No pages";
}

// Settings → Roles (store admin): make roles - a name and, per page, None /
// Read / Read + Write - then give each staff login one of them (Team tab).
function RolesTab() {
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // { id?, name, permissions } while the editor is open.
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await teamService.listRoles();
      setRoles(data.roles || []);
      setCatalog(data.pages || []);
    } catch (err) {
      setError(err.message || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave(e) {
    e.preventDefault();
    if (!Object.keys(editing.permissions || {}).length) {
      setError("Give the role at least one page (Read or Read + Write)");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body = { name: editing.name, permissions: editing.permissions };
      if (editing.id) await teamService.updateRole(editing.id, body);
      else await teamService.createRole(body);
      setSuccess(editing.id ? "Role Updated." : "Role Created.");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message || "Failed to save the role");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(role) {
    if (!window.confirm("Click to confirm")) return;
    setError("");
    setSuccess("");
    try {
      await teamService.deleteRole(role.id);
      setSuccess("Role Deleted.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to delete the role");
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {success ? <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p> : null}

      {editing ? (
        <form onSubmit={onSave} className="space-y-4 rounded-lg border border-surface-border bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-900">{editing.id ? "Edit Role" : "New Role"}</h2>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Role Name</span>
            <input
              required
              maxLength={80}
              placeholder="e.g. Order Desk"
              value={editing.name}
              onChange={(e) => setEditing((r) => ({ ...r, name: e.target.value }))}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-80"
            />
          </label>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Page Access</p>
            <PermissionGrid
              catalog={catalog}
              value={editing.permissions}
              onChange={(permissions) => setEditing((r) => ({ ...r, permissions }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setEditing({ name: "", permissions: {} })}>New Role</Button>
      )}

      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Roles</h2>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading…</p>
        ) : roles.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No roles yet - make one, then give it to a login on the Team tab.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {role.name}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {role.member_count} {role.member_count === 1 ? "Login" : "Logins"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{permissionSummary(role.permissions, catalog)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEditing({ id: role.id, name: role.name, permissions: { ...role.permissions } })}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={role.member_count > 0}
                    title={role.member_count > 0 ? "Give its logins another role first" : undefined}
                    onClick={() => onDelete(role)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// What a login can do, picked right on the Team form: tap a module (OMS,
// IMS, WMS, ...) and its pages open below it - each None / Read / Read +
// Write. A saved role can fill it in as a start.
function AccessPicker({ catalog, roles, value, onChange }) {
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
        {roles.length ? (
          <select
            value=""
            onChange={(e) => {
              const role = roles.find((r) => String(r.id) === e.target.value);
              if (role) onChange({ ...(role.permissions || {}) });
            }}
            className="ml-auto rounded-md border border-surface-border bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-brand-500"
            title="Fill the pages in from a saved role"
          >
            <option value="">Start From a Role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        ) : null}
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

// Settings → Team (store admin): staff logins - username (on the store's
// domain), password, and the pages they can open (AccessPicker).
function TeamTab() {
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
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
      const [team, roleData] = await Promise.all([teamService.listMembers(), teamService.listRoles()]);
      setMembers(team.members || []);
      setEmailDomain(team.email_domain || "");
      setRoles(roleData.roles || []);
      setCatalog(roleData.pages || []);
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

  return (
    <div className="max-w-3xl space-y-6">
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
            roles={roles}
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
          <ul className="divide-y divide-surface-border">
            {members.map((m) => (
              <li key={m.user_id} className="px-5 py-4">
                {editingId === m.user_id ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-slate-900">Edit {m.email || m.user_id}</p>
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
                        roles={roles}
                        value={editForm.permissions}
                        onChange={(permissions) => setEditForm((f) => ({ ...f, permissions }))}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" loading={saving} onClick={() => onSaveMember(m)}>
                        Save
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{m.email || m.user_id}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {m.access
                          ? `${m.page_permissions ? "" : `Role · ${m.role_name} · `}${permissionSummary(m.access, catalog)}`
                          : `Old Access · ${moduleLabels(m.allowed_modules)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="secondary" onClick={() => openEdit(m)}>
                        Edit Access / Login
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => onRemove(m.user_id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
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
  { key: "roles", label: "Roles", adminOnly: true },
];

export default function SettingsPage() {
  const user = useEffectiveUser();
  // Stores, staff logins and roles: the store admin only.
  const isOrgAdmin = user?.role === "org_admin" || user?.isOrgAdmin === true;
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    const asked = searchParams.get("tab") || "account";
    return asked === "rbac" ? "team" : asked;
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
        {tab === "roles" && isOrgAdmin ? <RolesTab /> : null}
      </div>
    </div>
  );
}
