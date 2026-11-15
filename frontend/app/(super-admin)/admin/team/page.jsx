"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "../../../../components/shared/Button";
import Modal from "../../../../components/shared/Modal";
import PasswordInput from "../../../../components/shared/PasswordInput";
import adminTeamService from "../../../../services/adminTeamService";
import { formatDate } from "../../../../lib/formatDate";

const LEVELS = [
  { value: "", label: "None" },
  { value: "read", label: "Read" },
  { value: "write", label: "Read + Write" },
];

function LevelButtons({ level, onPick }) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-surface-border">
      {LEVELS.map((o) => (
        <button
          key={o.value || "none"}
          type="button"
          onClick={() => onPick(o.value)}
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
  );
}

function SetAll({ onPick }) {
  return (
    <span className="flex gap-2 text-xs">
      {LEVELS.map((o) => (
        <button key={o.value || "none"} type="button" onClick={() => onPick(o.value)} className="text-brand-700 hover:underline">
          All {o.label}
        </button>
      ))}
    </span>
  );
}

function PageRow({ page, level, onPick, short }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span>
        <span className="text-sm text-slate-800">{short ? page.label.replace(/^Dispatch Hub · /, "") : page.label}</span>
        {page.hint && !page.group ? <span className="block text-xs text-slate-400">{page.hint}</span> : null}
        {page.key === "dispatch_hub" ? <span className="block text-xs text-slate-400">{page.hint}</span> : null}
      </span>
      <LevelButtons level={level} onPick={onPick} />
    </li>
  );
}

// Every super admin page with None / Read / Read + Write. The Dispatch Hub
// is one group: open it to pick the pages inside the Hub one by one.
function PagePicker({ pages, value, onChange }) {
  const granted = value || {};
  const flat = pages.filter((p) => p.group !== "hub");
  const hub = pages.filter((p) => p.group === "hub");
  const hubCount = hub.filter((p) => granted[p.key]).length;
  const [hubOpen, setHubOpen] = useState(hubCount > 0);

  function setPage(key, level) {
    const next = { ...granted };
    if (level) next[key] = level;
    else delete next[key];
    onChange(next);
  }
  function setMany(list, level) {
    const next = { ...granted };
    list.forEach((p) => {
      if (level) next[p.key] = level;
      else delete next[p.key];
    });
    onChange(next);
  }

  return (
    <div className="overflow-hidden rounded-md border border-surface-border">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Super admin pages</span>
        <SetAll onPick={(level) => setMany(pages, level)} />
      </div>
      <ul className="divide-y divide-surface-border">
        {flat.map((page) => (
          <PageRow key={page.key} page={page} level={granted[page.key] || ""} onPick={(l) => setPage(page.key, l)} />
        ))}
        <li>
          <button
            type="button"
            onClick={() => setHubOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface"
          >
            <span>
              <span className="text-sm font-medium text-slate-800">Dispatch Hub</span>
              <span className="block text-xs text-slate-400">
                {hubCount ? `${hubCount} of ${hub.length} pages given` : "Open to pick the pages inside the Hub"}
              </span>
            </span>
            <span className="text-xs font-medium text-brand-700">{hubOpen ? "Close ▲" : "Open ▼"}</span>
          </button>
          {hubOpen ? (
            <div className="border-t border-surface-border bg-slate-50/60 pl-4">
              <div className="flex justify-end px-3 py-1.5">
                <SetAll onPick={(level) => setMany(hub, level)} />
              </div>
              <ul className="divide-y divide-surface-border border-t border-surface-border">
                {hub.map((page) => (
                  <PageRow key={page.key} page={page} short level={granted[page.key] || ""} onPick={(l) => setPage(page.key, l)} />
                ))}
              </ul>
              <p className="px-3 py-2 text-xs text-slate-500">
                Without &quot;Hub stores &amp; rates&quot;, clicking Dispatch Hub opens the Hub straight on the first page
                given here.
              </p>
            </div>
          ) : null}
        </li>
      </ul>
    </div>
  );
}

function AccessBadges({ access, pages }) {
  const list = pages.filter((p) => access?.[p.key]);
  if (!list.length) return <span className="text-xs text-slate-400">No access</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((p) => {
        const read = access[p.key] === "read";
        return (
          <span
            key={p.key}
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
              read ? "bg-slate-100 text-slate-600" : "bg-brand-50 text-brand-700"
            }`}
          >
            {p.label}
            {read ? " · Read" : ""}
          </span>
        );
      })}
    </div>
  );
}

// Role picker + "Custom pages" - a login gets a role, or its own pages.
function AccessChooser({ roles, pages, form, setForm }) {
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-slate-700">Role</span>
        <select
          value={form.role_id}
          onChange={(e) => setForm((f) => ({ ...f, role_id: e.target.value }))}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">Custom pages (no role)</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {form.role_id ? (
        <AccessBadges access={roles.find((r) => r.id === form.role_id)?.permissions} pages={pages} />
      ) : (
        <PagePicker pages={pages} value={form.permissions} onChange={(permissions) => setForm((f) => ({ ...f, permissions }))} />
      )}
    </div>
  );
}

const EMPTY_STAFF = { email: "", name: "", password: "", role_id: "", permissions: {} };
const EMPTY_ROLE = { name: "", permissions: {} };

// Super admin side Admin Team (owners only): FynkTech staff logins with
// some super admin pages, and the roles that group those pages.
export default function AdminTeamPage() {
  const [data, setData] = useState({ pages: [], roles: [], staff: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [staffForm, setStaffForm] = useState(null); // null | {mode: "add"|"edit", ...}
  const [roleForm, setRoleForm] = useState(null); // null | {id?, name, permissions}
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminTeamService.overview();
      setData({ pages: res.pages || [], roles: res.roles || [], staff: res.staff || [] });
    } catch (err) {
      setError(err.message || "Failed to load the admin team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn, message) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
      return true;
    } catch (err) {
      setError(err.message || "Something went wrong");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveStaff() {
    const f = staffForm;
    const access = f.role_id ? { role_id: f.role_id } : { permissions: f.permissions };
    const ok =
      f.mode === "add"
        ? await run(
            () => adminTeamService.createStaff({ email: f.email, name: f.name, password: f.password, ...access }),
            `${f.email} can now sign in at /superadmin.`,
          )
        : await run(
            () =>
              adminTeamService.updateStaff(f.user_id, {
                name: f.name,
                ...(f.password ? { password: f.password } : {}),
                access: true,
                ...access,
              }),
            `${f.email} updated.`,
          );
    if (ok) setStaffForm(null);
  }

  async function saveRole() {
    const f = roleForm;
    const body = { name: f.name, permissions: f.permissions };
    const ok = await run(
      () => (f.id ? adminTeamService.updateRole(f.id, body) : adminTeamService.createRole(body)),
      f.id ? `Role "${f.name}" saved - everyone with it has the new access now.` : `Role "${f.name}" created.`,
    );
    if (ok) setRoleForm(null);
  }

  function removeStaff(s) {
    if (!window.confirm(`Remove ${s.email}? The login is deleted and can no longer sign in.`)) return;
    run(() => adminTeamService.removeStaff(s.user_id), `${s.email} removed.`);
  }

  function deleteRole(r) {
    if (!window.confirm(`Delete the role "${r.name}"?`)) return;
    run(() => adminTeamService.deleteRole(r.id), `Role "${r.name}" deleted.`);
  }

  const { pages, roles, staff } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin Team</h1>
          <p className="mt-1 text-sm text-slate-500">
            Give other people some of the super admin pages. Each page is None, Read (look only) or Read + Write.
            Only owners - like you - can open this page.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setRoleForm({ ...EMPTY_ROLE })}>
            New role
          </Button>
          <Button onClick={() => setStaffForm({ mode: "add", ...EMPTY_STAFF })}>Add login</Button>
        </div>
      </div>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

      <section className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Logins</h2>
        </div>
        {loading && !staff.length ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading…</p>
        ) : !staff.length ? (
          <p className="px-5 py-6 text-sm text-slate-500">No staff logins yet - Add login to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-surface text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Login</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Access</th>
                  <th className="whitespace-nowrap px-4 py-2.5">Added On</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.user_id} className="border-b border-surface-border align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{s.email}</p>
                      {s.name ? <p className="text-xs text-slate-500">{s.name}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.role_name || "Custom pages"}</td>
                    <td className="px-4 py-3">
                      <AccessBadges access={s.access} pages={pages} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(s.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5"
                          onClick={() =>
                            setStaffForm({
                              mode: "edit",
                              user_id: s.user_id,
                              email: s.email,
                              name: s.name || "",
                              password: "",
                              role_id: s.role_id || "",
                              permissions: s.page_permissions || s.access || {},
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button variant="secondary" className="px-3 py-1.5" onClick={() => removeStaff(s)}>
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
      </section>

      <section className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        <div className="border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Roles</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            A role is a set of pages. Changing a role changes the access of every login that has it.
          </p>
        </div>
        {!roles.length ? (
          <p className="px-5 py-6 text-sm text-slate-500">No roles yet - New role to make one.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {roles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0 space-y-1.5">
                  <p className="font-medium text-slate-900">
                    {r.name}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {r.staff_count || 0} login{r.staff_count === 1 ? "" : "s"}
                    </span>
                  </p>
                  <AccessBadges access={r.permissions} pages={pages} />
                </div>
                <div className="inline-flex gap-2">
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5"
                    onClick={() => setRoleForm({ id: r.id, name: r.name, permissions: r.permissions || {} })}
                  >
                    Edit
                  </Button>
                  <Button variant="secondary" className="px-3 py-1.5" onClick={() => deleteRole(r)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {staffForm ? (
        <Modal
          open
          onClose={() => setStaffForm(null)}
          title={staffForm.mode === "add" ? "Add login" : `Edit ${staffForm.email}`}
          width="max-w-2xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setStaffForm(null)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={saveStaff}>
                {staffForm.mode === "add" ? "Create login" : "Save"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700">Email</span>
                <input
                  type="email"
                  value={staffForm.email}
                  disabled={staffForm.mode === "edit"}
                  autoComplete="off"
                  onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-surface"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700">Name</span>
                <input
                  value={staffForm.name}
                  onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1.5 block font-medium text-slate-700">
                  {staffForm.mode === "add" ? "Password" : "New password (leave blank to keep)"}
                </span>
                <PasswordInput
                  minLength={8}
                  autoComplete="new-password"
                  value={staffForm.password}
                  onChange={(e) => setStaffForm((f) => ({ ...f, password: e.target.value }))}
                />
              </label>
            </div>
            <AccessChooser roles={roles} pages={pages} form={staffForm} setForm={setStaffForm} />
            {staffForm.mode === "add" ? (
              <p className="text-xs text-slate-500">They sign in on the super admin login page (/superadmin).</p>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {roleForm ? (
        <Modal
          open
          onClose={() => setRoleForm(null)}
          title={roleForm.id ? `Edit role "${roleForm.name}"` : "New role"}
          width="max-w-2xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRoleForm(null)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={saveRole}>
                Save role
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Role name</span>
              <input
                value={roleForm.name}
                placeholder="e.g. Dispatch team, Accounts, Support"
                onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <PagePicker
              pages={pages}
              value={roleForm.permissions}
              onChange={(permissions) => setRoleForm((f) => ({ ...f, permissions }))}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
