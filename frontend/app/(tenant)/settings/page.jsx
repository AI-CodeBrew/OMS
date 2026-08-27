"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../../../lib/supabaseClient";
import Button from "../../../components/shared/Button";
import PasswordInput from "../../../components/shared/PasswordInput";
import { STAFF_MODULE_OPTIONS } from "../../../components/layout/moduleNav";
import teamService from "../../../services/teamService";
import useAuthStore from "../../../store/authStore";

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
    if (password.length < 6) {
      setPasswordError("Password must be at least 6 characters");
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
          <Button type="submit" disabled={emailLoading}>
            {emailLoading ? "Saving…" : "Update email"}
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
          <Button type="submit" disabled={passwordLoading}>
            {passwordLoading ? "Saving…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function moduleLabels(modules) {
  const keys = modules || [];
  if (!keys.length) return "No modules";
  return keys
    .map((key) => STAFF_MODULE_OPTIONS.find((o) => o.key === key)?.label || key)
    .join(", ");
}

function ModuleToggles({ value, onChange }) {
  function toggle(key) {
    const set = new Set(value || []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange(STAFF_MODULE_OPTIONS.map((o) => o.key).filter((k) => set.has(k)));
  }

  return (
    <div className="flex flex-wrap gap-2">
      {STAFF_MODULE_OPTIONS.map((opt) => {
        const on = (value || []).includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggle(opt.key)}
            aria-pressed={on}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              on
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-surface-border bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {opt.label}
            <span className="ml-2 text-xs opacity-80">{on ? "On" : "Off"}</span>
          </button>
        );
      })}
    </div>
  );
}

function RoleAccessTab() {
  const [members, setMembers] = useState([]);
  const [emailDomain, setEmailDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [invite, setInvite] = useState({
    username: "",
    password: "",
    modules: ["oms"],
  });
  const [inviting, setInviting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    modules: [],
    username: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await teamService.listMembers();
      setMembers(data.members || []);
      setEmailDomain(data.email_domain || "");
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
    if (!(invite.modules || []).length) {
      setError("Turn on at least one module");
      return;
    }
    setInviting(true);
    setError("");
    setSuccess("");
    try {
      const created = await teamService.inviteMember(invite);
      setInvite({ username: "", password: "", modules: ["oms"] });
      const login = created?.member?.email || `${invite.username}@${emailDomain}`;
      setSuccess(`Team member added. Login: ${login}`);
      await load();
    } catch (err) {
      setError(err.message || "Failed to invite");
    } finally {
      setInviting(false);
    }
  }

  function openEdit(member) {
    setEditingId(member.user_id);
    setEditForm({
      modules: [...(member.allowed_modules || [])],
      username: member.username || (member.email || "").split("@")[0] || "",
      password: "",
    });
    setError("");
    setSuccess("");
  }

  async function onSaveMember(userId) {
    if (!(editForm.modules || []).length) {
      setError("Turn on at least one module");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = { modules: editForm.modules };
      if (editForm.username) payload.username = editForm.username;
      if (editForm.password) payload.password = editForm.password;
      await teamService.updateMember(userId, payload);
      setEditingId(null);
      setSuccess(
        "Staff updated. Ask them to sign out and back in if module tabs look wrong."
      );
      await load();
    } catch (err) {
      setError(err.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(userId) {
    if (!window.confirm("Remove this team member from the organization?")) return;
    setError("");
    setSuccess("");
    try {
      await teamService.removeMember(userId);
      setSuccess("Member removed.");
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

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>
      ) : null}

      <form
        onSubmit={onInvite}
        className="space-y-4 rounded-lg border border-surface-border bg-white p-6"
      >
        <h2 className="text-sm font-semibold text-slate-900">Add team member</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Username</span>
            <div className="flex overflow-hidden rounded-md border border-surface-border focus-within:border-brand-500">
              <input
                required
                autoComplete="off"
                placeholder="john"
                value={invite.username}
                onChange={(e) =>
                  setInvite((f) => ({
                    ...f,
                    username: e.target.value.replace(/@.*$/, "").toLowerCase(),
                  }))
                }
                className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
              />
              {domainSuffix ? (
                <span className="flex items-center bg-slate-50 px-3 text-sm text-slate-500">
                  {domainSuffix}
                </span>
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
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Module access
          </p>
          <ModuleToggles
            value={invite.modules}
            onChange={(modules) => setInvite((f) => ({ ...f, modules }))}
          />
        </div>
        <Button type="submit" disabled={inviting}>
          {inviting ? "Adding…" : "Add"}
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Organization users</h2>
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
                    <p className="text-sm font-medium text-slate-900">
                      Edit {m.email || m.user_id}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="mb-1 block text-slate-600">Username</span>
                        <div className="flex overflow-hidden rounded-md border border-surface-border focus-within:border-brand-500">
                          <input
                            value={editForm.username}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                username: e.target.value.replace(/@.*$/, "").toLowerCase(),
                              }))
                            }
                            className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
                          />
                          {domainSuffix ? (
                            <span className="flex items-center bg-slate-50 px-3 text-sm text-slate-500">
                              {domainSuffix}
                            </span>
                          ) : null}
                        </div>
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-slate-600">
                          New password (optional)
                        </span>
                        <PasswordInput
                          minLength={8}
                          placeholder="Leave blank to keep current"
                          value={editForm.password}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, password: e.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Module access
                      </p>
                      <ModuleToggles
                        value={editForm.modules}
                        onChange={(modules) => setEditForm((f) => ({ ...f, modules }))}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={saving}
                        onClick={() => onSaveMember(m.user_id)}
                      >
                        {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{m.email || m.user_id}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {moduleLabels(m.allowed_modules)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="secondary" onClick={() => openEdit(m)}>
                        Edit access / credentials
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onRemove(m.user_id)}
                      >
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

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const isOrgAdmin =
    user?.role === "org_admin" || user?.isOrgAdmin === true;
  const [tab, setTab] = useState("account");

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
      <div className="mt-4 flex gap-1 border-b border-surface-border">
        <button
          type="button"
          onClick={() => setTab("account")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "account"
              ? "border-b-2 border-brand-600 text-brand-700"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Account
        </button>
        {isOrgAdmin ? (
          <button
            type="button"
            onClick={() => setTab("rbac")}
            className={`px-4 py-2 text-sm font-medium ${
              tab === "rbac"
                ? "border-b-2 border-brand-600 text-brand-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Role-based access
          </button>
        ) : null}
      </div>
      <div className="mt-6">
        {tab === "account" ? <AccountTab user={user} /> : null}
        {tab === "rbac" && isOrgAdmin ? <RoleAccessTab /> : null}
      </div>
    </div>
  );
}
