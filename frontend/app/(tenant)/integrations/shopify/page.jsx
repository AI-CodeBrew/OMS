"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import integrationsService from "../../../../services/integrationsService";
import Button from "../../../../components/shared/Button";
import PasswordInput from "../../../../components/shared/PasswordInput";

const SHOPIFY_ERROR_MESSAGES = {
  invalid_request: "The Shopify install request could not be verified. Please try again.",
  token_exchange_failed: "Shopify did not confirm the install. Please try again.",
  save_failed: "Shopify install succeeded but couldn't be staged. Please try again.",
  oms_not_configured: "The Shopify connector isn't configured yet - contact support.",
};

const EMPTY_FORM = { shop_domain: "", access_token: "", webhook_secret: "" };
const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function previousMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function LayersIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l9 5-9 5-9-5 9-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function ShopifyIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 8h12l1 12H5L6 8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 8a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ShieldIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoltIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function UnlinkIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 15 15 9M8 5l1-1a3 3 0 0 1 4.24 4.24l-1 1M16 19l-1 1a3 3 0 0 1-4.24-4.24l1-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FeatureToggle({ title, description, checked, disabled, title2, onChange }) {
  return (
    <label className={`flex items-start gap-3 rounded-md border border-surface-border p-3 ${disabled ? "opacity-60" : ""}`} title={title2}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  );
}

export default function IntegrationsPage() {
  const router = useRouter();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [shopDomainInput, setShopDomainInput] = useState("");
  const [startingConnect, setStartingConnect] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState(null);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglingWebhooks, setTogglingWebhooks] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [checkingGaps, setCheckingGaps] = useState(false);
  const [gapReport, setGapReport] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const pollRef = useRef(null);

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const data = await integrationsService.getShopifyStatus();
      setStatus(data);
      return data;
    } catch (err) {
      setError(err.message || "Failed to load integration status");
      return null;
    } finally {
      setLoading(false);
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSyncing(false);
  }

  function startPolling() {
    if (pollRef.current) return;
    setSyncing(true);
    pollRef.current = setInterval(async () => {
      try {
        const job = await integrationsService.getSyncJobStatus();
        setSyncJob(job);
        if (!ACTIVE_JOB_STATUSES.has(job.status)) {
          stopPolling();
          if (job.status === "completed") {
            const modeLabel =
              job.mode === "full" ? "Full sync" : job.mode === "custom" ? "Custom range sync" : "New orders";
            const refreshed = await loadStatus();
            const skippedNote = job.skipped_count
              ? ` (${job.skipped_count} skipped due to bad data — last: ${job.error_message})`
              : "";
            setNotice(
              `${modeLabel}: ${job.created_count} new, ${job.updated_count} updated — ${job.total_fetched} orders fetched, ${refreshed?.synced_orders_count ?? "?"} total as of ${job.finished_at ? new Date(job.finished_at).toLocaleString() : ""}.${skippedNote}`
            );
          } else if (job.status === "failed") {
            setError(job.error_message || "Sync failed");
          } else if (job.status === "cancelled") {
            setNotice(`Sync cancelled — ${job.total_fetched} orders processed before stopping.`);
            await loadStatus();
          }
        }
      } catch {
        // Transient poll failure - just try again on the next tick.
      }
    }, 2000);
  }

  useEffect(() => {
    loadStatus();
    // Resume polling if a sync was already running (e.g. page refresh mid-sync).
    integrationsService
      .getSyncJobStatus()
      .then((job) => {
        setSyncJob(job);
        if (job && ACTIVE_JOB_STATUSES.has(job.status)) startPolling();
      })
      .catch(() => {});
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Landed back here from fynk-tech-ai's OAuth callback - finish connecting
  // (or surface why the install didn't complete), then drop the query
  // params so a refresh doesn't repeat it. Reads window.location directly
  // (rather than useSearchParams) so this doesn't need a Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectedFlag = params.get("connected");
    const shopifyError = params.get("shopify_error");
    if (!connectedFlag && !shopifyError) return;

    if (shopifyError) {
      setError(SHOPIFY_ERROR_MESSAGES[shopifyError] || "Shopify install failed. Please try again.");
      router.replace("/integrations/shopify");
      return;
    }

    (async () => {
      setError("");
      setNotice("");
      try {
        await integrationsService.finalizeShopifyConnect();
        setNotice("Shopify store connected.");
        await loadStatus();
      } catch (err) {
        setError(err.message || "Failed to finish connecting Shopify");
      } finally {
        router.replace("/integrations/shopify");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status?.shop_domain) setShopDomainInput(status.shop_domain);
  }, [status?.shop_domain]);

  const connected = Boolean(status?.connected);

  async function onStartShopifyConnect(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setStartingConnect(true);
    try {
      const data = await integrationsService.startShopifyConnect(shopDomainInput.trim());
      window.location.href = data.install_url;
    } catch (err) {
      setError(err.message || "Failed to start Shopify install");
      setStartingConnect(false);
    }
  }

  async function onConnect(e) {
    e.preventDefault();
    setConnecting(true);
    setError("");
    setNotice("");
    try {
      const data = await integrationsService.connectShopify(form);
      setStatus(data);
      setForm(EMPTY_FORM);
      setNotice(
        data.webhook_warnings
          ? `Saved, but webhook registration had issues: ${data.webhook_warnings.join("; ")}`
          : "Credentials saved. Webhooks registered for orders/create and orders/updated."
      );
    } catch (err) {
      setError(err.message || "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  async function onTestConnection() {
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const data = await integrationsService.testConnection(form);
      setNotice(`Connection OK — ${data.shop_name || "store"} (${data.currency || "no currency"}).`);
    } catch (err) {
      setError(err.message || "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  async function onSync({ full = false, dateFrom: from, dateTo: to, ranges } = {}) {
    setError("");
    setNotice("");
    try {
      const job = await integrationsService.syncNow({ full, dateFrom: from, dateTo: to, ranges });
      setSyncJob(job);
      startPolling();
    } catch (err) {
      setError(err.message || "Sync failed");
    }
  }

  async function onCheckGaps() {
    setCheckingGaps(true);
    setError("");
    setNotice("");
    setGapReport(null);
    try {
      setGapReport(await integrationsService.checkGaps());
    } catch (err) {
      setError(err.message || "Failed to check for missing orders");
    } finally {
      setCheckingGaps(false);
    }
  }

  function onBackfillGaps() {
    // Sync only the specific day ranges that are short, rather than one
    // span covering everything between the first and last gap - that would
    // re-pull every complete month in between (thousands of orders) to
    // recover a few hundred.
    const ranges = gapReport?.ranges || [];
    if (ranges.length === 0) return;
    setGapReport(null);
    onSync({ ranges: ranges.map((r) => ({ from: r.from, to: r.to })) });
  }

  function onSyncRange() {
    if (!dateFrom && !dateTo) return;
    onSync({ dateFrom, dateTo });
  }

  async function onCancelSync() {
    try {
      const job = await integrationsService.cancelSync();
      setSyncJob(job);
      stopPolling();
      setNotice(`Sync cancelled — ${job.total_fetched} orders processed before stopping.`);
      await loadStatus();
    } catch (err) {
      setError(err.message || "Failed to cancel sync");
    }
  }

  function onPickPreviousMonth() {
    const { from, to } = previousMonthRange();
    setDateFrom(from);
    setDateTo(to);
  }

  async function onToggleAutoSync(enabled) {
    setError("");
    try {
      const data = await integrationsService.setAutoSyncOrders(enabled);
      setStatus((s) => ({ ...s, ...data }));
    } catch (err) {
      setError(err.message || "Failed to update setting");
    }
  }

  async function onToggleWebhooks(enabled) {
    setError("");
    setTogglingWebhooks(true);
    try {
      const data = await integrationsService.setWebhooksActive(enabled);
      setStatus((s) => ({ ...s, ...data }));
      if (data.webhook_warnings) {
        setNotice(`Webhooks partially registered: ${data.webhook_warnings.join("; ")}`);
      }
    } catch (err) {
      setError(err.message || "Failed to update webhooks");
    } finally {
      setTogglingWebhooks(false);
    }
  }

  async function onDisconnect() {
    if (!window.confirm("Disconnect this Shopify store? You can reconnect any time.")) return;
    setDisconnecting(true);
    setError("");
    try {
      await integrationsService.disconnect();
      setNotice("Disconnected.");
      await loadStatus();
    } catch (err) {
      setError(err.message || "Failed to disconnect");
    } finally {
      setDisconnecting(false);
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
        <span className="font-medium text-slate-700">Shopify</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand-50 p-2.5 text-brand-600">
            <LayersIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Store Integrations</h1>
            <p className="mt-1 text-sm text-slate-500">
              Connect your Shopify e-commerce store with your website for automated order syncing
              and live status updates.
            </p>
          </div>
        </div>
        <a
          href="https://help.shopify.com/en/manual/apps/app-types/custom-apps"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-surface"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px]">
            ?
          </span>
          How to Get Shopify Credentials
        </a>
      </div>

      <div className="my-6 border-t border-surface-border" />

      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <div className="rounded-lg border border-surface-border bg-white p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                  <ShopifyIcon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Shopify</p>
                  <p className="text-xs text-slate-500">E-Commerce Store</p>
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
                    <span className="text-slate-500">Store Name:</span>
                    <span className="font-medium text-slate-900">{status.shop_name || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Domain:</span>
                    <span className="truncate font-medium text-brand-600">{status.shop_domain}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Synced Orders:</span>
                    <span className="font-medium text-slate-900">{status.synced_orders_count ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last Sync:</span>
                    <span className="font-medium text-slate-900">
                      {status.last_synced_at ? new Date(status.last_synced_at).toLocaleString() : "Never"}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => onSync({ full: false })} loading={syncing} className="flex-1 justify-center">
                    {status.last_synced_at ? "Sync New Orders" : "Full Sync (All Orders)"}
                  </Button>
                  <button
                    type="button"
                    onClick={onDisconnect}
                    disabled={disconnecting || syncing}
                    title="Disconnect"
                    className="flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    <UnlinkIcon className="h-4 w-4" />
                  </button>
                </div>

                {syncing && syncJob ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">
                        Syncing… {syncJob.total_fetched}
                        {syncJob.total_available != null ? ` of ${syncJob.total_available}` : ""} orders
                        {syncJob.total_available != null
                          ? ` (${Math.max(syncJob.total_available - syncJob.total_fetched, 0)} remaining)`
                          : ""}{" "}
                        — page {syncJob.pages_fetched}
                        {syncJob.skipped_count ? `, ${syncJob.skipped_count} skipped` : ""}
                      </p>
                      <button
                        type="button"
                        onClick={onCancelSync}
                        className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                    {syncJob.total_available ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all"
                          style={{
                            width: `${Math.min(
                              (syncJob.total_fetched / syncJob.total_available) * 100,
                              100
                            )}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {status.last_synced_at ? (
                  <button
                    type="button"
                    onClick={() => onSync({ full: true })}
                    disabled={syncing}
                    className="mt-2 w-full text-center text-xs text-slate-500 hover:text-brand-600 disabled:opacity-50"
                  >
                    Re-pull entire order history instead
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => setRangeOpen((o) => !o)}
                  className="mt-1 w-full text-center text-xs text-slate-500 hover:text-brand-600"
                >
                  {rangeOpen ? "Hide custom date range" : "Sync a custom date range…"}
                </button>

                <button
                  type="button"
                  onClick={onCheckGaps}
                  disabled={checkingGaps || syncing}
                  className="mt-1 w-full text-center text-xs text-slate-500 hover:text-brand-600 disabled:opacity-50"
                >
                  {checkingGaps
                    ? "Scanning history day by day… (takes a minute)"
                    : "Check for missing orders"}
                </button>

                {gapReport ? (
                  <div className="mt-2 rounded-md border border-surface-border p-3">
                    {gapReport.gaps.length === 0 ? (
                      <p className="text-xs text-green-700">
                        No missing orders — all {gapReport.total_remote} orders are synced.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-slate-700">
                          {gapReport.missing} order{gapReport.missing === 1 ? "" : "s"} missing
                          across {gapReport.gaps.length} month
                          {gapReport.gaps.length === 1 ? "" : "s"}
                        </p>
                        <div className="mt-2 space-y-1">
                          {gapReport.gaps.map((gap) => (
                            <div
                              key={gap.from}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="text-slate-600">
                                {gap.label}
                                <span className="ml-1 text-slate-400">
                                  ({gap.local}/{gap.remote})
                                </span>
                              </span>
                              <span className="font-medium text-amber-600">−{gap.missing}</span>
                            </div>
                          ))}
                        </div>
                        <Button
                          onClick={onBackfillGaps}
                          disabled={syncing}
                          className="mt-3 w-full justify-center"
                        >
                          Backfill missing orders
                        </Button>
                        <p className="mt-1.5 text-[11px] text-slate-400">
                          Fetches only the {gapReport.ranges?.length || 0} affected date range
                          {gapReport.ranges?.length === 1 ? "" : "s"} (about {gapReport.missing}{" "}
                          orders) — not your whole history.
                        </p>
                      </>
                    )}
                  </div>
                ) : null}

                {rangeOpen ? (
                  <div className="mt-2 space-y-2 rounded-md border border-surface-border p-3">
                    <div className="flex gap-2">
                      <label className="flex-1 text-xs text-slate-500">
                        From
                        <input
                          type="date"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                          className="mt-0.5 w-full rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500"
                        />
                      </label>
                      <label className="flex-1 text-xs text-slate-500">
                        To
                        <input
                          type="date"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                          className="mt-0.5 w-full rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={onPickPreviousMonth}
                        className="rounded-md border border-surface-border px-2 py-1 text-xs text-slate-600 hover:bg-surface"
                      >
                        Previous Month
                      </button>
                      <Button
                        onClick={onSyncRange}
                        disabled={syncing || (!dateFrom && !dateTo)}
                        className="flex-1 justify-center"
                      >
                        Sync Range
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-4 border-t border-surface-border pt-4 text-sm text-slate-500">
                Not connected yet — enter your credentials to the right to connect your store.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-surface-border bg-white p-5">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <BoltIcon className="h-4 w-4 text-brand-600" />
              Sync Features
            </h3>
            <div className="space-y-2">
              <FeatureToggle
                title="Order Syncing"
                description="Import orders placed on Shopify into this system"
                checked={connected ? status.auto_sync_orders : false}
                disabled={!connected}
                onChange={onToggleAutoSync}
              />
              <FeatureToggle
                title="Real-time Webhooks"
                description="Instant order-create/update listeners"
                checked={connected ? status.webhooks_active : false}
                disabled={!connected || togglingWebhooks}
                onChange={onToggleWebhooks}
                title2="Registers/unregisters Shopify order-create and order-updated webhooks against this store."
              />
              <FeatureToggle
                title="Import Product Catalog"
                description="Sync titles, prices & images"
                checked={false}
                disabled
                title2="Not available - this integration syncs orders only, there's no product catalog in this system."
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-surface-border bg-white p-6">
          <div className="flex items-center gap-2">
            <ShieldIcon className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-semibold text-slate-900">
              {connected ? "Reconnect Shopify Store" : "Connect Shopify Store"}
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Install the FynkTech AI app on your store - no custom app to create, no token to copy.
          </p>

          <form onSubmit={onStartShopifyConnect} className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                Shopify Store URL <span className="text-red-500">*</span>
              </span>
              <input
                required
                placeholder="your-store.myshopify.com"
                value={shopDomainInput}
                onChange={(e) => setShopDomainInput(e.target.value)}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Your store&apos;s default domain ending in .myshopify.com
              </span>
            </label>

            <Button type="submit" loading={startingConnect} className="w-full justify-center">
              {connected ? "Reconnect Shopify" : "Connect Shopify"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="mt-4 w-full text-center text-xs text-slate-500 hover:text-brand-600"
          >
            {advancedOpen ? "Hide advanced option" : "Advanced: connect with a custom app token instead"}
          </button>

          {advancedOpen ? (
            <div className="mt-4 border-t border-surface-border pt-4">
              <p className="text-xs text-slate-500">
                From your Shopify Admin: Settings → Apps and sales channels → Develop apps → create a
                custom app with a <code>read_orders</code> Admin API scope. Install it to get the
                access token; the webhook secret is the app&apos;s API secret key shown on its
                credentials page.
              </p>

              <form onSubmit={onConnect} className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700">
                    Shopify Store URL <span className="text-red-500">*</span>
                  </span>
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
                    Admin API Access Token <span className="text-red-500">*</span>
                  </span>
                  <PasswordInput
                    required
                    placeholder="shpat_..."
                    value={form.access_token}
                    onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
                  />
                  <span className="mt-1 block text-xs text-slate-400">
                    Generated inside Shopify Admin → Develop apps → Admin API Access Token.
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700">
                    API Secret Key <span className="text-slate-400">(for Webhooks)</span>
                  </span>
                  <PasswordInput
                    required
                    value={form.webhook_secret}
                    onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
                  />
                  <span className="mt-1 block text-xs text-slate-400">
                    Used to cryptographically sign real-time webhook payloads from Shopify.
                  </span>
                </label>

                <div className="flex gap-2 border-t border-surface-border pt-4">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onTestConnection}
                    disabled={!form.shop_domain || !form.access_token}
                    loading={testing}
                  >
                    Test Connection
                  </Button>
                  <Button type="submit" loading={connecting} className="flex-1 justify-center">
                    {connected ? "Update Credentials" : "Connect Shopify"}
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
