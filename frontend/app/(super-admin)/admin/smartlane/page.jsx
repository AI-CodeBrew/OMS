"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "../../../../components/shared/Button";
import PasswordInput from "../../../../components/shared/PasswordInput";
import smartlaneAdminService from "../../../../services/smartlaneAdminService";

const EMPTY_FORM = {
  business_code: "",
  client_id: "",
  client_secret: "",
  jwt_token: "",
};

const EMPTY_COURIER = {
  key: "",
  label: "",
  carrier_name: "",
  service_type: "overland",
  warehouse_name_template: "{org} - {carrier}",
  auto_booking: true,
  is_active: true,
  sort_order: 0,
  notes: "",
};

const LINK_STATUS_TONE = {
  pending_approval: "bg-amber-50 text-amber-700",
  in_review: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  in_active: "bg-slate-100 text-slate-600",
  draft: "bg-slate-100 text-slate-600",
};

function Field({ label, hint, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-surface-border px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export default function SmartlaneBusinessPage() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [testResult, setTestResult] = useState(null);

  const [links, setLinks] = useState([]);
  const [busyLinkId, setBusyLinkId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  // Warehouses aren't part of the store link list response - fetched
  // lazily per link (keyed by link.id) the first time its panel is
  // opened, rather than for every link up front.
  const [warehouses, setWarehouses] = useState({});
  const [loadingWhId, setLoadingWhId] = useState(null);
  const [whForm, setWhForm] = useState({});
  const [provisioningId, setProvisioningId] = useState(null);
  const [couriers, setCouriers] = useState([]);
  const [courierForm, setCourierForm] = useState(EMPTY_COURIER);
  const [editingCourierId, setEditingCourierId] = useState(null);
  const [showCourierForm, setShowCourierForm] = useState(false);
  const [savingCourier, setSavingCourier] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [configData, courierData, linkData] = await Promise.all([
        smartlaneAdminService.getConfig(),
        smartlaneAdminService.listCouriers(),
        smartlaneAdminService.listStoreLinks(),
      ]);
      setConfig(configData.config);
      setCouriers(courierData.couriers || []);
      setLinks(linkData.links || []);
      setForm((f) => ({
        ...f,
        business_code: configData.config?.business_code || "",
        client_id: configData.config?.client_id || "",
      }));
    } catch (err) {
      setError(err.message || "Failed to load Smartlane business config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const data = await smartlaneAdminService.updateConfig(form);
      setConfig(data.config);
      // Secrets are fill-only server-side; clear the inputs so a blank box
      // reads as "unchanged" rather than looking like the value was lost.
      setForm((f) => ({ ...f, client_secret: "", jwt_token: "" }));
      setSuccess("Saved.");
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function onApproveLink(link) {
    if (
      !window.confirm(
        `Approve ${link.organization_name}? This sends their KYC to Smartlane, who then ` +
          `run their own review.`,
      )
    ) {
      return;
    }
    setBusyLinkId(link.id);
    setError("");
    setSuccess("");
    try {
      await smartlaneAdminService.approveStoreLink(link.id);
      setSuccess(`Sent ${link.organization_name} to Smartlane for review.`);
      await load();
    } catch (err) {
      setError(err.message || "Failed to approve");
    } finally {
      setBusyLinkId(null);
    }
  }

  async function onRejectLink(link) {
    const note = window.prompt(
      `Why is ${link.organization_name} being rejected? They see this.`,
    );
    if (note === null) return;
    if (!note.trim()) {
      setError("A reason is required — the organization sees it.");
      return;
    }
    setBusyLinkId(link.id);
    setError("");
    setSuccess("");
    try {
      await smartlaneAdminService.rejectStoreLink(link.id, note.trim());
      setSuccess(`Rejected ${link.organization_name}.`);
      await load();
    } catch (err) {
      setError(err.message || "Failed to reject");
    } finally {
      setBusyLinkId(null);
    }
  }

  async function onSyncStores() {
    setSyncing(true);
    setError("");
    setSuccess("");
    try {
      const result = await smartlaneAdminService.syncStoreLinks();
      setSuccess(
        `Checked ${result.stores_seen} store(s) at Smartlane, updated ${result.links_updated}.`,
      );
      await load();
    } catch (err) {
      setError(err.message || "Failed to sync");
    } finally {
      setSyncing(false);
    }
  }

  async function onOpenWarehouses(link, isOpen) {
    if (!isOpen || warehouses[link.id]) return;
    setLoadingWhId(link.id);
    try {
      const data = await smartlaneAdminService.getStoreWarehouses(link.id);
      setWarehouses((w) => ({ ...w, [link.id]: data.warehouses || [] }));
      setWhForm((f) => ({
        ...f,
        [link.id]: f[link.id] || { city: data.link?.kyc_city || "", zip_code: data.link?.kyc_zip_code || "" },
      }));
    } catch (err) {
      setError(err.message || "Failed to load warehouses");
    } finally {
      setLoadingWhId(null);
    }
  }

  async function onProvisionWarehouses(link) {
    const values = whForm[link.id] || {};
    if (!(values.city || "").trim()) {
      setError("City is required to provision a warehouse.");
      return;
    }
    setProvisioningId(link.id);
    setError("");
    setSuccess("");
    try {
      const data = await smartlaneAdminService.provisionStoreWarehouses(link.id, values);
      setWarehouses((w) => ({ ...w, [link.id]: data.warehouses || [] }));
      if (data.errors?.length) {
        setError(data.errors.map((e) => `${e.offering_key}: ${e.error}`).join(" · "));
      } else {
        setSuccess(
          `Provisioned ${data.provisioned?.length || 0} warehouse(s) for ${link.organization_name}.`,
        );
      }
    } catch (err) {
      setError(err.message || "Failed to provision warehouses");
    } finally {
      setProvisioningId(null);
    }
  }

  function startCreateCourier() {
    setCourierForm(EMPTY_COURIER);
    setEditingCourierId(null);
    setShowCourierForm(true);
    setError("");
  }

  function startEditCourier(courier) {
    setCourierForm({ ...EMPTY_COURIER, ...courier });
    setEditingCourierId(courier.id);
    setShowCourierForm(true);
    setError("");
  }

  async function onSaveCourier(e) {
    e.preventDefault();
    setSavingCourier(true);
    setError("");
    setSuccess("");
    try {
      if (editingCourierId) {
        // key is write-once server-side; sending it back would be ignored
        // anyway, so keep the request honest about what it changes.
        const { key, ...patch } = courierForm;
        await smartlaneAdminService.updateCourier(editingCourierId, patch);
      } else {
        await smartlaneAdminService.createCourier(courierForm);
      }
      setShowCourierForm(false);
      setEditingCourierId(null);
      setCourierForm(EMPTY_COURIER);
      setSuccess("Courier saved.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to save courier");
    } finally {
      setSavingCourier(false);
    }
  }

  async function onToggleCourier(courier) {
    setError("");
    try {
      await smartlaneAdminService.updateCourier(courier.id, { is_active: !courier.is_active });
      await load();
    } catch (err) {
      setError(err.message || "Failed to update courier");
    }
  }

  async function onDeleteCourier(courier) {
    if (
      !window.confirm(
        `Delete "${courier.label}" permanently? Deactivating it instead keeps the record ` +
          `and just hides it from organizations.`,
      )
    ) {
      return;
    }
    setError("");
    try {
      await smartlaneAdminService.deleteCourier(courier.id);
      await load();
    } catch (err) {
      setError(err.message || "Failed to delete courier");
    }
  }

  async function onTest() {
    setTesting(true);
    setError("");
    setSuccess("");
    setTestResult(null);
    try {
      const data = await smartlaneAdminService.testConnection();
      setTestResult(data);
      if (data.config) setConfig(data.config);
    } catch (err) {
      setError(err.message || "Test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Smartlane Business API</h1>
          <p className="mt-1 text-sm text-slate-500">
            The platform&apos;s own Smartlane business account. Organizations onboard as stores
            underneath it instead of bringing their own API key.
          </p>
        </div>
        <Button variant="secondary" onClick={onTest} loading={testing} disabled={loading}>
          Test Connection
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
      ) : null}

      {loading ? (
        <p className="px-1 py-10 text-sm text-slate-500">Loading configuration…</p>
      ) : (
        <>
          <div className="rounded-xl border border-surface-border bg-white shadow-sm">
            <div className="border-b border-surface-border px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Status</h2>
            </div>
            <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Environment</dt>
                <dd className="mt-1 break-all text-sm text-slate-800">{config?.base_url}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Configured</dt>
                <dd className="mt-1 text-sm">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      config?.is_configured
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {config?.is_configured ? "Business code + token set" : "Incomplete"}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Last verified</dt>
                <dd className="mt-1 text-sm text-slate-800">
                  {config?.last_verified_at
                    ? new Date(config.last_verified_at).toLocaleString()
                    : "Never"}
                </dd>
              </div>
            </dl>
            {config?.last_verify_error ? (
              <div className="border-t border-surface-border px-5 py-3">
                <p className="text-xs text-red-600">{config.last_verify_error}</p>
              </div>
            ) : null}
          </div>

          {testResult ? (
            <div
              className={`rounded-xl border shadow-sm ${
                testResult.ok
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-red-200 bg-red-50/50"
              }`}
            >
              <div className="border-b border-surface-border px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-800">
                  {testResult.ok ? "Handshake succeeded" : "Handshake failed"}
                </h2>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm">
                {testResult.ok ? (
                  <pre className="overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                    {JSON.stringify(testResult.response, null, 2)}
                  </pre>
                ) : (
                  <p className="text-red-700">{testResult.error}</p>
                )}

                {/* The signing inputs are the whole point of this panel: a
                    rejected signature says nothing useful on its own, and
                    the only way to find the mismatch is to compare this
                    string byte for byte against a PHP reference. */}
                {testResult.debug ? (
                  <details open={!testResult.ok}>
                    <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
                      Signature detail
                    </summary>
                    <dl className="mt-2 space-y-2">
                      {[
                        ["String to sign", testResult.debug.string_to_sign],
                        ["Signed URL", testResult.debug.signed_url],
                        ["Signature", testResult.debug.signature],
                        ["Body sent", testResult.debug.body_sent ?? "(none)"],
                        ["HTTP status", String(testResult.debug.status_code ?? "—")],
                        ["Response", testResult.debug.response_body || "(empty)"],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-xs uppercase tracking-wide text-slate-400">
                            {label}
                          </dt>
                          <dd className="mt-0.5 whitespace-pre-wrap break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-700">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}

          <form
            onSubmit={onSave}
            className="space-y-4 rounded-xl border border-surface-border bg-white p-6 shadow-sm"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Credentials</h2>
              <p className="mt-1 text-xs text-slate-500">
                Paste the business code, client id, secret, and Auth token Smartlane sent.
                The Auth token is the HMAC key (not a login JWT). Test Connection should
                then return &quot;Business API - Version 1.0&quot;.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business code" hint="Used in every endpoint path.">
                <input
                  value={form.business_code}
                  onChange={(e) => setForm({ ...form, business_code: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Client ID">
                <input
                  value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field
                label="Client secret"
                hint={config?.has_client_secret ? "Stored. Leave blank to keep it." : "Not set yet."}
              >
                <PasswordInput
                  value={form.client_secret}
                  onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                  placeholder={config?.has_client_secret ? "••••••••" : ""}
                />
              </Field>
            </div>

            <Field
              label="Auth token"
              hint={
                config?.has_jwt_token
                  ? "Stored. Leave blank to keep it — paste a new one if they reissue it."
                  : "Not set yet. Paste the Auth token from Smartlane (HMAC key)."
              }
            >
              <PasswordInput
                value={form.jwt_token}
                onChange={(e) => setForm({ ...form, jwt_token: e.target.value })}
                placeholder={config?.has_jwt_token ? "••••••••" : ""}
              />
            </Field>

            <div className="flex justify-end">
              <Button type="submit" loading={saving}>
                Save credentials
              </Button>
            </div>
          </form>

          <div className="rounded-xl border border-surface-border bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Onboarding requests</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Approving sends the organization&apos;s KYC to Smartlane, who then run their
                  own review before the store goes live.
                </p>
              </div>
              <Button variant="secondary" onClick={onSyncStores} loading={syncing}>
                Sync from Smartlane
              </Button>
            </div>

            {links.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-slate-700">No requests yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Organizations request access from their Integrations page.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-surface-border">
                {links.map((link) => (
                  <li key={link.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">
                            {link.organization_name}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              LINK_STATUS_TONE[link.status] || "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {link.status_display}
                          </span>
                          {link.smartlane_store_id ? (
                            <span className="text-xs text-slate-500">
                              store <span className="font-mono">{link.smartlane_store_id}</span>
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {link.kyc?.name || "—"} · {link.kyc?.industry || "no industry"} ·{" "}
                          {link.kyc?.email || "no email"} · {link.kyc?.phone || "no phone"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Couriers: {(link.requested_offerings || []).join(", ") || "none"}
                        </p>
                        {link.review_note ? (
                          <p className="mt-1 text-xs text-red-600">
                            Rejected: {link.review_note}
                          </p>
                        ) : null}
                      </div>

                      {link.status === "pending_approval" ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => onRejectLink(link)}
                            disabled={busyLinkId === link.id}
                          >
                            Reject
                          </Button>
                          <Button
                            onClick={() => onApproveLink(link)}
                            loading={busyLinkId === link.id}
                          >
                            Approve
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                        Full KYC
                      </summary>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        {Object.entries(link.kyc || {}).map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-xs uppercase tracking-wide text-slate-400">
                              {k.replace(/_/g, " ")}
                            </dt>
                            <dd className="text-xs text-slate-700">{v === null || v === "" ? "—" : String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>

                    {link.status === "active" ? (
                      <details
                        className="mt-2"
                        onToggle={(e) => onOpenWarehouses(link, e.target.open)}
                      >
                        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                          Warehouses
                        </summary>
                        <div className="mt-2 rounded-lg border border-surface-border bg-slate-50/60 p-3">
                          {loadingWhId === link.id ? (
                            <p className="text-xs text-slate-500">Loading…</p>
                          ) : (
                            <>
                              {(warehouses[link.id] || []).length === 0 ? (
                                <p className="text-xs text-slate-500">
                                  None provisioned yet.
                                </p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {(warehouses[link.id] || []).map((w) => (
                                    <li
                                      key={w.id}
                                      className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                    >
                                      <span className="text-slate-700">
                                        {w.offering_label}
                                        {w.smartlane_warehouse_code ? (
                                          <span className="ml-1.5 font-mono text-slate-500">
                                            {w.smartlane_warehouse_code}
                                          </span>
                                        ) : null}
                                      </span>
                                      <span
                                        className={`rounded-full px-2 py-0.5 font-medium ${
                                          w.status === "active"
                                            ? "bg-emerald-50 text-emerald-700"
                                            : w.status === "failed"
                                              ? "bg-red-50 text-red-700"
                                              : "bg-slate-100 text-slate-600"
                                        }`}
                                      >
                                        {w.status}
                                      </span>
                                      {w.status === "failed" && w.last_provision_error ? (
                                        <span className="w-full text-red-600">
                                          {w.last_provision_error}
                                        </span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <div className="mt-3 flex flex-wrap items-end gap-2">
                                <label className="text-xs">
                                  <span className="mb-1 block text-slate-500">City</span>
                                  <input
                                    value={whForm[link.id]?.city || ""}
                                    onChange={(e) =>
                                      setWhForm((f) => ({
                                        ...f,
                                        [link.id]: { ...f[link.id], city: e.target.value },
                                      }))
                                    }
                                    placeholder="Lahore"
                                    className="w-32 rounded-md border border-surface-border px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                                  />
                                </label>
                                <label className="text-xs">
                                  <span className="mb-1 block text-slate-500">Zip code</span>
                                  <input
                                    value={whForm[link.id]?.zip_code || ""}
                                    onChange={(e) =>
                                      setWhForm((f) => ({
                                        ...f,
                                        [link.id]: { ...f[link.id], zip_code: e.target.value },
                                      }))
                                    }
                                    placeholder="54000"
                                    className="w-24 rounded-md border border-surface-border px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                                  />
                                </label>
                                <Button
                                  variant="secondary"
                                  onClick={() => onProvisionWarehouses(link)}
                                  loading={provisioningId === link.id}
                                >
                                  Provision warehouses
                                </Button>
                              </div>
                              <p className="mt-1.5 text-[11px] text-slate-400">
                                Not part of the KYC form yet - Smartlane&apos;s warehouse
                                endpoint needs city/zip separately. One warehouse is created
                                per requested courier that doesn&apos;t already have one.
                              </p>
                            </>
                          )}
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-surface-border bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Couriers offered</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  What organizations choose from. Smartlane has no courier API — approving one
                  of these creates a warehouse on their store, and booking against that
                  warehouse is what picks the carrier.
                </p>
              </div>
              <Button variant="secondary" onClick={startCreateCourier}>
                Add courier
              </Button>
            </div>

            {couriers.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-slate-700">No couriers yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Add one per carrier you want to resell — Trax, Leopards, TCS and so on.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-surface-border">
                {couriers.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{c.label}</span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            c.is_active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {c.is_active ? "Active" : "Hidden"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        <span className="font-mono">{c.key}</span> · {c.service_type}
                        {c.auto_booking ? " · auto-booking" : ""} · warehouse “
                        {(c.warehouse_name_template || "{org} - {carrier}")
                          .replace("{org}", "Org")
                          .replace("{carrier}", c.carrier_name || c.label)
                          .replace("{label}", c.label)}
                        ”
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEditCourier(c)}
                        className="text-sm font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleCourier(c)}
                        className="text-sm font-medium text-slate-500 hover:underline"
                      >
                        {c.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCourier(c)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {showCourierForm ? (
            <form
              onSubmit={onSaveCourier}
              className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/50 p-6 shadow-sm"
            >
              <h2 className="text-sm font-semibold text-slate-800">
                {editingCourierId ? "Edit courier" : "New courier"}
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Key"
                  hint={
                    editingCourierId
                      ? "Cannot be changed — organizations reference it."
                      : "Slug, e.g. trax. Permanent once saved."
                  }
                >
                  <input
                    required
                    value={courierForm.key}
                    disabled={Boolean(editingCourierId)}
                    onChange={(e) => setCourierForm({ ...courierForm, key: e.target.value })}
                    placeholder="trax"
                    className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
                  />
                </Field>
                <Field label="Label" hint="What organizations see.">
                  <input
                    required
                    value={courierForm.label}
                    onChange={(e) => setCourierForm({ ...courierForm, label: e.target.value })}
                    placeholder="Smartlane - Trax"
                    className={inputClass}
                  />
                </Field>
                <Field label="Carrier name" hint="Used in the Smartlane warehouse name.">
                  <input
                    value={courierForm.carrier_name}
                    onChange={(e) =>
                      setCourierForm({ ...courierForm, carrier_name: e.target.value })
                    }
                    placeholder="Trax"
                    className={inputClass}
                  />
                </Field>
                <Field label="Service type">
                  <select
                    value={courierForm.service_type}
                    onChange={(e) =>
                      setCourierForm({ ...courierForm, service_type: e.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="overland">Overland</option>
                    <option value="overnight">Overnight</option>
                  </select>
                </Field>
                <Field
                  label="Warehouse name template"
                  hint="Placeholders: {org}, {carrier}."
                >
                  <input
                    value={courierForm.warehouse_name_template}
                    onChange={(e) =>
                      setCourierForm({ ...courierForm, warehouse_name_template: e.target.value })
                    }
                    className={inputClass}
                  />
                </Field>
                <Field label="Sort order" hint="Lower shows first.">
                  <input
                    type="number"
                    min="0"
                    value={courierForm.sort_order}
                    onChange={(e) =>
                      setCourierForm({ ...courierForm, sort_order: e.target.value })
                    }
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="Notes" hint="Internal only.">
                <input
                  value={courierForm.notes}
                  onChange={(e) => setCourierForm({ ...courierForm, notes: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={courierForm.auto_booking}
                    onChange={(e) =>
                      setCourierForm({ ...courierForm, auto_booking: e.target.checked })
                    }
                  />
                  Auto booking
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={courierForm.is_active}
                    onChange={(e) =>
                      setCourierForm({ ...courierForm, is_active: e.target.checked })
                    }
                  />
                  Visible to organizations
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCourierForm(false);
                    setEditingCourierId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={savingCourier}>
                  {editingCourierId ? "Save changes" : "Add courier"}
                </Button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
