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

// Mirrors backend/integrations/business_services.py's API_TEST_ACTIONS
// keys exactly - the dispatcher rejects anything not in that whitelist.
const API_ACTIONS = [
  { value: "store_list", label: "Store list" },
  { value: "store_kyc", label: "New store KYC" },
  { value: "industries", label: "Industries" },
  { value: "city_list", label: "City list" },
  { value: "finance_products", label: "Finance products" },
  { value: "activity_log", label: "Activity log", storeScoped: true },
  { value: "warehouse_list", label: "Warehouse list", storeScoped: true },
  { value: "warehouse_save", label: "Add/Edit warehouse", storeScoped: true },
  { value: "finance_information", label: "Finance information", storeScoped: true },
  { value: "apply_finance", label: "Apply finance", storeScoped: true },
  { value: "consignment_create", label: "Create consignment", storeScoped: true },
  { value: "consignment_track", label: "Track consignment", storeScoped: true },
  { value: "consignment_cancel", label: "Cancel consignment", storeScoped: true },
  { value: "airway_bill", label: "Airway bill", storeScoped: true },
  { value: "load_sheet", label: "Load sheet", storeScoped: true },
  { value: "shipper_advice_get", label: "Shipper advice (list)", storeScoped: true },
  { value: "shipper_advice_update", label: "Shipper advice (update)", storeScoped: true },
  { value: "webhook_list", label: "Webhook list" },
  { value: "webhook_register", label: "Webhook register" },
];

const LINK_STATUS_TONE = {
  pending_approval: "bg-amber-50 text-amber-700",
  in_review: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  approved: "bg-emerald-50 text-emerald-700",
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

  const [apiAction, setApiAction] = useState(API_ACTIONS[0].value);
  const [apiStoreId, setApiStoreId] = useState("");
  const [apiParams, setApiParams] = useState("");
  const [apiTesting, setApiTesting] = useState(false);
  const [apiResult, setApiResult] = useState(null);

  // All Stores (doc #3) - separate from `links` above, which is only our
  // own onboarding requests. Search always filters by name; the eye icon
  // is the one way to see everything.
  const [storesSearch, setStoresSearch] = useState("");
  const [stores, setStores] = useState(null);
  const [storesLoading, setStoresLoading] = useState(false);

  // Activity Log (doc #4). Smartlane's `type` param is required, not
  // optional like the doc's prose implies - "consignment_status" is the
  // only value confirmed against their Postman collection so far.
  const [logStoreId, setLogStoreId] = useState("");
  const [logSearch, setLogSearch] = useState("consignment_status");
  const [logResult, setLogResult] = useState(null);
  const [logLoading, setLogLoading] = useState(false);

  // Webhook / warehouse-edit / finance requests (doc #6/#7, #9, #11)
  const [requestTypeFilter, setRequestTypeFilter] = useState("");
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [configData, linkData] = await Promise.all([
        smartlaneAdminService.getConfig(),
        smartlaneAdminService.listStoreLinks(),
      ]);
      setConfig(configData.config);
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

  async function onRunApiTest() {
    let extra = {};
    if (apiParams.trim()) {
      try {
        extra = JSON.parse(apiParams);
      } catch {
        setError("Extra params must be valid JSON.");
        return;
      }
    }
    // store_id from its own field, but an explicit one in the JSON
    // textarea wins - lets webhook_register's own store_id (a different
    // store than the one you're currently poking at) override it.
    const params = apiStoreId.trim() ? { store_id: apiStoreId.trim(), ...extra } : extra;

    setApiTesting(true);
    setError("");
    setApiResult(null);
    try {
      const data = await smartlaneAdminService.runApiTest(apiAction, params);
      setApiResult(data);
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setApiTesting(false);
    }
  }

  async function onBrowseStores() {
    if (!storesSearch.trim()) {
      setError('Enter a store name, or click the eye icon to see all stores.');
      return;
    }
    setStoresLoading(true);
    setError("");
    try {
      const data = await smartlaneAdminService.browseStores(storesSearch.trim());
      setStores(data.stores || []);
    } catch (err) {
      setError(err.message || "Failed to load stores");
    } finally {
      setStoresLoading(false);
    }
  }

  async function onShowAllStores() {
    setStoresLoading(true);
    setError("");
    try {
      const data = await smartlaneAdminService.browseStores();
      setStores(data.stores || []);
    } catch (err) {
      setError(err.message || "Failed to load stores");
    } finally {
      setStoresLoading(false);
    }
  }

  async function onLoadActivityLog() {
    if (!logStoreId.trim()) {
      setError("Store ID is required.");
      return;
    }
    if (!logSearch.trim()) {
      setError("Type is required — Smartlane rejects the call without it.");
      return;
    }
    setLogLoading(true);
    setError("");
    try {
      const data = await smartlaneAdminService.getActivityLog(logStoreId.trim(), logSearch.trim());
      setLogResult(data.activity);
    } catch (err) {
      setError(err.message || "Failed to load activity log");
    } finally {
      setLogLoading(false);
    }
  }

  const loadRequests = useCallback(async (type) => {
    setRequestsLoading(true);
    setError("");
    try {
      const data = await smartlaneAdminService.listRequests({ type: type || undefined });
      setRequests(data.requests || []);
    } catch (err) {
      setError(err.message || "Failed to load requests");
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests(requestTypeFilter);
  }, [requestTypeFilter, loadRequests]);

  async function onApproveRequest(req) {
    if (!window.confirm(`Approve this ${req.request_type.replace("_", " ")} request for ${req.organization_name}?`)) {
      return;
    }
    setBusyRequestId(req.id);
    setError("");
    setSuccess("");
    try {
      await smartlaneAdminService.approveRequest(req.id);
      setSuccess(`Approved ${req.organization_name}'s ${req.request_type.replace("_", " ")} request.`);
      await loadRequests(requestTypeFilter);
    } catch (err) {
      setError(err.message || "Failed to approve");
    } finally {
      setBusyRequestId(null);
    }
  }

  async function onRejectRequest(req) {
    const note = window.prompt(`Why is this request being rejected? ${req.organization_name} sees this.`);
    if (note === null) return;
    if (!note.trim()) {
      setError("A reason is required — the organization sees it.");
      return;
    }
    setBusyRequestId(req.id);
    setError("");
    setSuccess("");
    try {
      await smartlaneAdminService.rejectRequest(req.id, note.trim());
      setSuccess(`Rejected ${req.organization_name}'s request.`);
      await loadRequests(requestTypeFilter);
    } catch (err) {
      setError(err.message || "Failed to reject");
    } finally {
      setBusyRequestId(null);
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
          <details className="group rounded-xl border border-surface-border bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 [&::-webkit-details-marker]:hidden">
              <h2 className="text-sm font-semibold text-slate-800">Status</h2>
              <span className="-rotate-90 text-slate-400 transition-transform group-open:rotate-0">▾</span>
            </summary>
            <dl className="grid gap-4 border-t border-surface-border px-5 py-5 sm:grid-cols-2">
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
          </details>

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

          <details className="group rounded-xl border border-surface-border bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-3 [&::-webkit-details-marker]:hidden">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Credentials</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Paste the business code, client id, secret, and Auth token Smartlane sent.
                  The Auth token is the HMAC key (not a login JWT). Test Connection should
                  then return &quot;Business API - Version 1.0&quot;.
                </p>
              </div>
              <span className="-rotate-90 shrink-0 text-slate-400 transition-transform group-open:rotate-0">▾</span>
            </summary>
            <form onSubmit={onSave} className="space-y-4 border-t border-surface-border p-6">
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
          </details>

          <details className="group rounded-xl border border-surface-border bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-3 [&::-webkit-details-marker]:hidden">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">API Explorer</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Fire any Smartlane business-API call directly and see the raw result — the
                  same thing Postman was used for, without leaving the OMS. Store list,
                  Industries, City list and Finance products need no store and work today;
                  everything else needs an active store first.
                </p>
              </div>
              <span className="-rotate-90 shrink-0 text-slate-400 transition-transform group-open:rotate-0">▾</span>
            </summary>
            <div className="space-y-3 border-t border-surface-border px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <Field label="Action">
                  <select
                    value={apiAction}
                    onChange={(e) => setApiAction(e.target.value)}
                    className={inputClass}
                  >
                    {API_ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                        {a.storeScoped ? "" : " (no store needed)"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Store ID" hint="Only for store-scoped actions.">
                  <input
                    value={apiStoreId}
                    onChange={(e) => setApiStoreId(e.target.value)}
                    placeholder="e.g. 5"
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field
                label="Extra params (JSON)"
                hint={
                  'e.g. {"store_order_ids": ["SLTEST001"]}, or {"body": {...}} for ' +
                  "store_kyc / warehouse_save / consignment_create / shipper_advice_update."
                }
              >
                <textarea
                  rows={4}
                  value={apiParams}
                  onChange={(e) => setApiParams(e.target.value)}
                  placeholder="{}"
                  className={`${inputClass} font-mono text-xs`}
                />
              </Field>
              <div className="flex justify-end">
                <Button onClick={onRunApiTest} loading={apiTesting}>
                  Send
                </Button>
              </div>
            </div>

            {apiResult ? (
              <div
                className={`border-t px-5 py-4 text-sm ${
                  apiResult.ok
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-red-200 bg-red-50/50"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p
                    className={`text-sm font-semibold ${
                      apiResult.ok ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {apiResult.ok ? "Success" : "Failed"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setApiResult(null)}
                    title="Close"
                    className="rounded-full px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </div>
                {apiResult.ok ? (
                  <pre className="max-h-96 overflow-auto rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                    {JSON.stringify(apiResult.response, null, 2)}
                  </pre>
                ) : (
                  <p className="text-red-700">{apiResult.error}</p>
                )}
                {apiResult.debug ? (
                  <details open={!apiResult.ok} className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
                      Signature detail
                    </summary>
                    <dl className="mt-2 space-y-2">
                      {[
                        ["Method", apiResult.debug.method],
                        ["String to sign", apiResult.debug.string_to_sign],
                        ["Signed URL", apiResult.debug.signed_url],
                        ["Signature", apiResult.debug.signature],
                        ["Body sent", apiResult.debug.body_sent ?? "(none)"],
                        ["HTTP status", String(apiResult.debug.status_code ?? "—")],
                        ["Response", apiResult.debug.response_body || "(empty)"],
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
            ) : null}
          </details>

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
                                Smartlane&apos;s warehouse endpoint needs city/zip separately
                                from KYC.
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
            <div className="border-b border-surface-border px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">All Stores</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Every store Smartlane has on file for this business, not just the ones onboarded
                through this OMS.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2 px-5 py-4">
              <Field label="Search">
                <input
                  value={storesSearch}
                  onChange={(e) => setStoresSearch(e.target.value)}
                  placeholder="Store name…"
                  className={inputClass}
                />
              </Field>
              <Button variant="secondary" onClick={onBrowseStores} loading={storesLoading}>
                Search
              </Button>
              <button
                type="button"
                onClick={onShowAllStores}
                title="Show all stores"
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                <span aria-hidden="true">👁</span> All
              </button>
            </div>
            {stores ? (
              stores.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-slate-500">No stores found.</p>
              ) : (
                <ul className="divide-y divide-surface-border">
                  {stores.map((s, i) => (
                    <li key={s.id || s.store_id || i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                      <span className="text-slate-800">{s.name || "—"}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          LINK_STATUS_TONE[s.status] || "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {s.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>

          <div className="rounded-xl border border-surface-border bg-white shadow-sm">
            <div className="border-b border-surface-border px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Activity Log</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Request, response and webhook log for one store.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2 px-5 py-4">
              <Field label="Store ID">
                <input
                  value={logStoreId}
                  onChange={(e) => setLogStoreId(e.target.value)}
                  placeholder="e.g. 5"
                  className={inputClass}
                />
              </Field>
              <Field label="Type (required)">
                <select
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className={inputClass}
                >
                  <option value="consignment_status">Consignment status</option>
                </select>
              </Field>
              <Button variant="secondary" onClick={onLoadActivityLog} loading={logLoading}>
                Load
              </Button>
            </div>
            {logResult ? (
              <pre className="mx-5 mb-5 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {JSON.stringify(logResult, null, 2)}
              </pre>
            ) : null}
          </div>

          <div className="rounded-xl border border-surface-border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Requests</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Webhook, warehouse edit/revoke and finance-application requests. Approving
                  sends the one Smartlane call it represents; nothing is sent until then.
                </p>
              </div>
              <select
                value={requestTypeFilter}
                onChange={(e) => setRequestTypeFilter(e.target.value)}
                className={`${inputClass} w-auto`}
              >
                <option value="">All types</option>
                <option value="webhook">Webhook</option>
                <option value="warehouse_edit">Warehouse edit/revoke</option>
                <option value="finance">Finance application</option>
              </select>
            </div>

            {requestsLoading ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">Loading…</p>
            ) : requests.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No requests yet.</p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {requests.map((req) => (
                  <li key={req.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">
                            {req.organization_name}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                            {req.request_type.replace("_", " ")}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              LINK_STATUS_TONE[req.status] || "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {req.status_display}
                          </span>
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-all text-xs text-slate-500">
                          {JSON.stringify(req.payload)}
                        </pre>
                        {req.review_note ? (
                          <p className="mt-1 text-xs text-red-600">Rejected: {req.review_note}</p>
                        ) : null}
                      </div>
                      {req.status === "pending_approval" ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => onRejectRequest(req)}
                            disabled={busyRequestId === req.id}
                          >
                            Reject
                          </Button>
                          <Button
                            onClick={() => onApproveRequest(req)}
                            loading={busyRequestId === req.id}
                          >
                            Approve
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
