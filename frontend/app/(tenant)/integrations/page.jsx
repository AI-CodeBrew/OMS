"use client";

import { useEffect, useState } from "react";
import integrationsService from "../../../services/integrationsService";
import Button from "../../../components/shared/Button";

export default function IntegrationsPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({ shop_domain: "", access_token: "", webhook_secret: "" });

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const data = await integrationsService.getShopifyStatus();
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

  async function onConnect(e) {
    e.preventDefault();
    setConnecting(true);
    setError("");
    setNotice("");
    try {
      const data = await integrationsService.connectShopify(form);
      setStatus(data);
      setNotice(
        data.webhook_warnings
          ? `Connected, but webhook registration had issues: ${data.webhook_warnings.join("; ")}`
          : "Connected. Webhooks registered for orders/create and orders/updated."
      );
    } catch (err) {
      setError(err.message || "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  async function onSync() {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const data = await integrationsService.syncNow();
      setNotice(`Synced: ${data.created} new, ${data.updated} updated (${data.total_fetched} fetched).`);
      await loadStatus();
    } catch (err) {
      setError(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Integrations</h1>
      <p className="mt-1 text-sm text-slate-500">
        Connect Shopify to sync orders automatically via webhooks.
      </p>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      <div className="mt-6 rounded-lg border border-surface-border bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Shopify</h2>

        {status?.connected ? (
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <p>
              Store: <span className="font-medium">{status.shop_domain}</span>
            </p>
            <p>Currency: {status.currency || "—"}</p>
            <p>
              Last synced:{" "}
              {status.last_synced_at ? new Date(status.last_synced_at).toLocaleString() : "never"}
            </p>
            <div className="pt-2">
              <Button onClick={onSync} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            </div>
            <p className="pt-2 text-xs text-slate-500">
              New orders arrive automatically via webhook as soon as they're placed in Shopify.
              On localhost, webhook delivery won't actually reach this machine — Shopify's
              servers need a public URL (tunnel it with ngrok, or deploy) for real-time delivery
              to work. Use &quot;Sync now&quot; to pull recent orders manually in the meantime.
            </p>
          </div>
        ) : (
          <form onSubmit={onConnect} className="mt-4 space-y-3">
            <p className="text-xs text-slate-500">
              From your Shopify Admin: Settings → Apps and sales channels → Develop apps → create
              a custom app with an <code>read_orders</code> Admin API scope. Install it to get the
              access token; the webhook secret is the app&apos;s API secret key shown on its
              credentials page.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Shop domain</span>
              <input
                required
                placeholder="your-store.myshopify.com"
                value={form.shop_domain}
                onChange={(e) => setForm((f) => ({ ...f, shop_domain: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                Admin API access token
              </span>
              <input
                required
                type="password"
                placeholder="shpat_..."
                value={form.access_token}
                onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                Webhook secret (API secret key)
              </span>
              <input
                required
                type="password"
                value={form.webhook_secret}
                onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <Button type="submit" disabled={connecting}>
              {connecting ? "Connecting…" : "Connect Shopify"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
