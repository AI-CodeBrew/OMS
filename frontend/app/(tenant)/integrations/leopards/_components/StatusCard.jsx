"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../../../../../components/shared/Button";
import leopardsService from "../_lib/leopardsService";

const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);

function CopyField({ label, value, secret = false }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked - the value is still selectable in the input.
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <div className="flex gap-2">
        <input
          readOnly
          type={secret && !revealed ? "password" : "text"}
          value={value || ""}
          onClick={(e) => e.target.select()}
          className="w-full rounded-md border border-surface-border bg-slate-50 px-3 py-2 text-xs text-slate-600"
        />
        {secret ? (
          <Button variant="secondary" onClick={() => setRevealed((r) => !r)}>
            {revealed ? "Hide" : "Show"}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

// The two values Leopards' Push API portal asks for: the callback URL it
// should POST status updates to, and the one "Push API Header" value it sends
// with each call (the portal has no field for a header name). A call without
// that value is rejected by the backend, and the reason shows here.
function WebhookSection({ status, onChanged, onError, onNotice }) {
  const [regenerating, setRegenerating] = useState(false);

  async function onRegenerate() {
    if (
      !window.confirm(
        "Make a new webhook secret? The current one stops working right away - you'll need to give Leopards the new " +
          "header value."
      )
    ) {
      return;
    }
    setRegenerating(true);
    onError("");
    try {
      await leopardsService.regenerateWebhookSecret();
      onNotice("New webhook secret made - give Leopards the new Header Value.");
      onChanged();
    } catch (err) {
      onError(err.message || "Failed to regenerate the webhook secret");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-surface-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Status webhook</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            status.webhooks_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {status.webhooks_active ? "Active" : "Waiting for Leopards"}
        </span>
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">Calls received</dt>
          <dd className="text-slate-800">{status.events_received_count ?? 0}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Last call</dt>
          <dd className="text-slate-800">
            {status.last_event_at ? new Date(status.last_event_at).toLocaleString() : "Never"}
          </dd>
        </div>
      </dl>

      {status.last_webhook_error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {status.last_webhook_error}
          {status.last_webhook_error_at ? ` (${new Date(status.last_webhook_error_at).toLocaleString()})` : ""}
        </p>
      ) : null}

      <CopyField label="Callback URL (POST)" value={status.webhook_url} />
      <CopyField label="Header Value" value={status.webhook_header_value} secret />

      <p className="text-xs text-slate-500">
        Give these two values to Leopards for your account (Push API Management in their portal): the callback URL
        goes in "Push API URL" and the Header Value in "Push API Header". Once Leopards starts pushing, the pill
        above turns Active.
      </p>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {regenerating ? "Making a new secret…" : "Regenerate secret"}
      </button>
    </div>
  );
}

export default function StatusCard({ status, onChanged, onDisconnect, onError, onNotice }) {
  const [syncJob, setSyncJob] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Same 2-second polling as BarqRaftar's Sync now button.
  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const job = await leopardsService.getSyncJobStatus();
        setSyncJob(job);
        if (!ACTIVE_JOB_STATUSES.has(job.status)) {
          stopPolling();
          if (job.status === "completed") {
            onNotice(`Sync finished: checked ${job.checked_count}, updated ${job.updated_count}.`);
            onChanged();
          } else if (job.status === "failed") {
            onError(job.error_message || "Sync failed");
          } else if (job.status === "cancelled") {
            onNotice(`Sync cancelled - ${job.checked_count} shipment(s) checked before stopping.`);
          }
        }
      } catch {
        // Transient poll failure - try again on the next tick.
      }
    }, 2000);
  }

  useEffect(() => {
    leopardsService
      .getSyncJobStatus()
      .then((job) => {
        setSyncJob(job);
        if (job && ACTIVE_JOB_STATUSES.has(job.status)) startPolling();
      })
      .catch(() => {});
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSyncNow() {
    if (!window.confirm("Sync shipment statuses from Leopards now?")) return;
    onError("");
    onNotice("");
    try {
      const job = await leopardsService.syncNow();
      setSyncJob(job);
      startPolling();
    } catch (err) {
      onError(err.message || "Failed to sync with Leopards");
    }
  }

  async function onCancelSync() {
    if (!window.confirm("Stop the sync? Shipments already updated are kept.")) return;
    try {
      const job = await leopardsService.cancelSync();
      setSyncJob(job);
      stopPolling();
      onNotice(`Sync cancelled - ${job.checked_count} shipment(s) checked before stopping.`);
    } catch (err) {
      onError(err.message || "Failed to cancel sync");
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  }

  const jobActive = syncJob && ACTIVE_JOB_STATUSES.has(syncJob.status);

  return (
    <div className="space-y-4 rounded-lg border border-surface-border bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Connection</h2>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
          Connected
        </span>
      </div>

      <dl className="space-y-1 text-sm">
        {status.shipper_name ? (
          <div className="flex justify-between">
            <dt className="text-slate-500">Leopards account</dt>
            <dd className="text-slate-800">{status.shipper_name}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="text-slate-500">Last status sync</dt>
          <dd className="text-slate-800">
            {status.last_synced_at ? new Date(status.last_synced_at).toLocaleString() : "Never"}
          </dd>
        </div>
      </dl>

      <div>
        <Button variant="secondary" className="w-full" loading={jobActive} onClick={onSyncNow} disabled={jobActive}>
          Sync statuses from Leopards now
        </Button>
        {syncJob && syncJob.status !== "idle" ? (
          <div className="mt-2 text-xs text-slate-500">
            {jobActive ? (
              <>
                <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-brand-600 transition-all"
                    style={{
                      width: syncJob.total_available
                        ? `${Math.min(100, (syncJob.checked_count / syncJob.total_available) * 100)}%`
                        : "10%",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>
                    Checked {syncJob.checked_count}
                    {syncJob.total_available ? ` of ${syncJob.total_available}` : ""}, updated{" "}
                    {syncJob.updated_count}
                  </span>
                  <button type="button" onClick={onCancelSync} className="text-red-600 hover:underline">
                    Cancel
                  </button>
                </div>
              </>
            ) : syncJob.status === "failed" ? (
              <span className="text-red-600">{syncJob.error_message || "Last sync failed."}</span>
            ) : (
              <span>
                Last sync: checked {syncJob.checked_count}, updated {syncJob.updated_count}.
              </span>
            )}
          </div>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">
          Statuses also arrive instantly through the webhook below, and are checked with Leopards every few minutes
          as a backup. Use this button to pull them right now.
        </p>
      </div>

      <WebhookSection status={status} onChanged={onChanged} onError={onError} onNotice={onNotice} />

      <Button variant="danger" className="w-full" loading={disconnecting} onClick={handleDisconnect}>
        Disconnect
      </Button>
    </div>
  );
}
