"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import integrationsService from "../../../../services/integrationsService";
import Button from "../../../../components/shared/Button";
import PasswordInput from "../../../../components/shared/PasswordInput";

const EMPTY_FORM = { api_key: "", webhook_secret: "", store_warehouse_code: "" };

function TruckIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M2 7h11v9H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 10h4l4 3v3h-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="6.5" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17.5" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function SmartlaneIntegrationPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [copied, setCopied] = useState(false);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [savingWarehouse, setSavingWarehouse] = useState(false);
  const [warehouses, setWarehouses] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const data = await integrationsService.getSmartlaneStatus();
      setStatus(data);
    } catch (err) {
      setError(err.message || "Failed to load integration status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    setWarehouseCode(status?.store_warehouse_code || "");
  }, [status?.store_warehouse_code]);

  const connected = Boolean(status?.connected);

  async function onSaveWarehouseCode(e) {
    e.preventDefault();
    setSavingWarehouse(true);
    setError("");
    setNotice("");
    try {
      const data = await integrationsService.updateSmartlaneWarehouse(warehouseCode.trim());
      setStatus(data);
      setNotice("Warehouse code saved.");
    } catch (err) {
      setError(err.message || "Failed to save warehouse code");
    } finally {
      setSavingWarehouse(false);
    }
  }

  // Pulls consignment numbers and delivery outcomes from Smartlane right
  // now, instead of waiting for a webhook that may never arrive.
  async function onSyncNow() {
    setSyncing(true);
    setError("");
    setSyncResult(null);
    try {
      const result = await integrationsService.syncSmartlane();
      setSyncResult(result);
      await loadStatus();
    } catch (err) {
      setError(err.message || "Failed to sync with Smartlane");
    } finally {
      setSyncing(false);
    }
  }

  async function onFetchWarehouses() {
    setLoadingWarehouses(true);
    setError("");
    try {
      const data = await integrationsService.getSmartlaneWarehouses();
      const list = Array.isArray(data) ? data : data.data || data.warehouses || data.result || [];
      setWarehouses(list);
      if (!list.length) setError("Smartlane returned no warehouses - create one on the Smartlane portal first.");
    } catch (err) {
      setError(err.message || "Failed to fetch warehouses");
    } finally {
      setLoadingWarehouses(false);
    }
  }

  async function onConnect(e) {
    e.preventDefault();
    setConnecting(true);
    setError("");
    setNotice("");
    try {
      const data = await integrationsService.connectSmartlane(form);
      setStatus(data);
      setForm(EMPTY_FORM);
      setNotice("Connected. Copy the webhook URL below into your Smartlane account's shipment webhook settings.");
    } catch (err) {
      setError(err.message || "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  async function onDisconnect() {
    if (!window.confirm("Disconnect Smartlane? You can reconnect any time.")) return;
    setDisconnecting(true);
    setError("");
    try {
      await integrationsService.disconnectSmartlane();
      setNotice("Disconnected.");
      await loadStatus();
    } catch (err) {
      setError(err.message || "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  async function onCopyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(status.webhook_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable - user can still select/copy manually.
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/integrations" className="hover:text-brand-600">
          Integrations
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-700">Smartlane</span>
      </nav>

      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-brand-50 p-2.5 text-brand-600">
          <TruckIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Smartlane</h1>
          <p className="mt-1 text-sm text-slate-500">
            Get real-time rates, create bookings, and receive live shipment tracking updates via
            webhook.
          </p>
        </div>
      </div>

      <div className="my-6 border-t border-surface-border" />

      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="rounded-lg border border-surface-border bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                <TruckIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Smartlane</p>
                <p className="text-xs text-slate-500">Courier &amp; Logistics</p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                connected ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-500" : "bg-slate-400"}`} />
              {connected ? "Connected" : "Not Connected"}
            </span>
          </div>

          {connected ? (
            <>
              <div className="mt-4 space-y-2 border-t border-surface-border pt-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Webhooks:</span>
                  <span className="font-medium text-slate-900">
                    {status.webhooks_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Events Received:</span>
                  <span className="font-medium text-slate-900">{status.events_received_count ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Event:</span>
                  <span className="font-medium text-slate-900">
                    {status.last_event_at ? new Date(status.last_event_at).toLocaleString() : "Never"}
                  </span>
                </div>
              </div>

              <div className="mt-4 border-t border-surface-border pt-4">
                <Button variant="secondary" onClick={onSyncNow} disabled={syncing}>
                  {syncing ? "Syncing…" : "Sync statuses from Smartlane now"}
                </Button>
                <span className="mt-1 block text-xs text-slate-400">
                  Asks Smartlane about every order still in progress and applies what comes
                  back - consignment numbers for Booking Pending orders, and delivered /
                  returned outcomes. Use this instead of waiting on the webhook.
                </span>
                {syncResult ? (
                  <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Checked {syncResult.checked} order{syncResult.checked === 1 ? "" : "s"},
                    updated {syncResult.updated}.
                    {syncResult.detail ? ` ${syncResult.detail}` : ""}
                    {syncResult.checked === 0
                      ? " (Nothing to check - no orders are booked with Smartlane and still in progress.)"
                      : ""}
                  </div>
                ) : null}
              </div>

              <div className="mt-4">
                <span className="mb-1 block text-xs font-medium text-slate-700">Webhook URL</span>
                <div className="flex items-center gap-1.5">
                  <input
                    readOnly
                    value={status.webhook_url || ""}
                    onFocus={(e) => e.target.select()}
                    className="w-full truncate rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs text-slate-600 outline-none"
                  />
                  <button
                    type="button"
                    onClick={onCopyWebhookUrl}
                    className="shrink-0 rounded-md border border-surface-border px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-surface"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <span className="mt-1 block text-xs text-slate-400">
                  Paste this into Smartlane&apos;s dashboard as your shipment status webhook callback.
                </span>
              </div>

              <div className="mt-4 border-t border-surface-border pt-4">
                <span className="mb-1 block text-xs font-medium text-slate-700">
                  Warehouse Code <span className="text-red-500">*</span>
                </span>
                <form onSubmit={onSaveWarehouseCode} className="flex items-center gap-1.5">
                  <input
                    value={warehouseCode}
                    onChange={(e) => setWarehouseCode(e.target.value)}
                    placeholder="Your-warehouse-code"
                    className="w-full rounded-md border border-surface-border px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                  />
                  <button
                    type="submit"
                    disabled={savingWarehouse}
                    className="shrink-0 rounded-md border border-surface-border px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-surface disabled:opacity-50"
                  >
                    {savingWarehouse ? "Saving…" : "Save"}
                  </button>
                </form>
                <button
                  type="button"
                  onClick={onFetchWarehouses}
                  disabled={loadingWarehouses}
                  className="mt-1.5 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                >
                  {loadingWarehouses ? "Fetching…" : "Fetch my warehouses from Smartlane"}
                </button>
                {warehouses?.length ? (
                  <ul className="mt-2 space-y-1 rounded-md border border-surface-border bg-surface/60 p-2 text-xs">
                    {warehouses.map((w) => (
                      <li key={w.code || w.warehouse_code || w.id}>
                        <button
                          type="button"
                          onClick={() => setWarehouseCode(w.code || w.warehouse_code || "")}
                          className="text-brand-600 hover:underline"
                        >
                          {w.name || w.warehouse_name || "Warehouse"} — {w.code || w.warehouse_code}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <span className="mt-1 block text-xs text-slate-400">
                  Required before booking any order through Smartlane - set it on the Smartlane
                  portal under Store &gt; Warehouse first if the fetch above comes back empty.
                </span>
              </div>

              <button
                type="button"
                onClick={onDisconnect}
                disabled={disconnecting}
                className="mt-4 w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </>
          ) : (
            <p className="mt-4 border-t border-surface-border pt-4 text-sm text-slate-500">
              Not connected yet — enter your credentials to the right to connect Smartlane.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-surface-border bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            {connected ? "Update Smartlane Credentials" : "Connect Smartlane"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Smartlane pushes shipment status updates (picked, dispatched, delivered, returned) to
            this system in real time via webhook — orders update automatically without any manual
            syncing.
          </p>

          <form onSubmit={onConnect} className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                API Key <span className="text-red-500">*</span>
              </span>
              <PasswordInput
                placeholder="smln_..."
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
              />
              <span className="mt-1 block text-xs text-slate-400">
                Used to create bookings, fetch tracking, and print documents.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                Warehouse Code <span className="text-slate-400">(can also be set after connecting)</span>
              </span>
              <input
                placeholder="Your-warehouse-code"
                value={form.store_warehouse_code}
                onChange={(e) => setForm((f) => ({ ...f, store_warehouse_code: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <span className="mt-1 block text-xs text-slate-400">
                From Smartlane&apos;s Store &gt; Warehouse section - required before any booking.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                Webhook Secret <span className="text-red-500">*</span>
              </span>
              <PasswordInput
                required
                value={form.webhook_secret}
                onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
              />
              <span className="mt-1 block text-xs text-slate-400">
                Used to verify that incoming webhook calls really came from Smartlane. Set the same
                secret on both sides.
              </span>
            </label>

            <div className="border-t border-surface-border pt-4">
              <Button type="submit" disabled={connecting} className="w-full justify-center">
                {connecting ? "Saving…" : connected ? "Update Credentials" : "Connect Smartlane"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
