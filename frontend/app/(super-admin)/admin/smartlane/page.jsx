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
  registered_ip: "",
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await smartlaneAdminService.getConfig();
      setConfig(data.config);
      setForm((f) => ({
        ...f,
        business_code: data.config?.business_code || "",
        client_id: data.config?.client_id || "",
        registered_ip: data.config?.registered_ip || "",
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
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Registered IP</dt>
                <dd className="mt-1 text-sm text-slate-800">{config?.registered_ip || "—"}</dd>
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
                From Smartlane&apos;s business portal. Sign in there with the client id, secret
                and this machine&apos;s public IP to get the JWT token — the token is bound to
                that IP, so calls from anywhere else are rejected.
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
              <Field label="Registered IP" hint="The IP registered in the portal, for reference.">
                <input
                  value={form.registered_ip}
                  onChange={(e) => setForm({ ...form, registered_ip: e.target.value })}
                  placeholder="e.g. 203.0.113.10"
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
              label="JWT token"
              hint={
                config?.has_jwt_token
                  ? "Stored. Leave blank to keep it — paste a new one when it expires."
                  : "Not set yet. Get it from the business portal."
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
        </>
      )}
    </div>
  );
}
