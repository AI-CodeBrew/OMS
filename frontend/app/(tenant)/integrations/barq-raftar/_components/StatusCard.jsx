"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../../../../../components/shared/Button";
import barqraftarService from "../_lib/barqraftarService";

const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);

export default function StatusCard({ status, onChanged, onDisconnect, onError, onNotice }) {
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState(null);
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSyncing(false);
  }

  // Same 2-second polling pattern as the Smartlane integration page's
  // Sync now button.
  function startPolling() {
    if (pollRef.current) return;
    setSyncing(true);
    pollRef.current = setInterval(async () => {
      try {
        const job = await barqraftarService.getSyncJobStatus();
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
        // Transient poll failure - just try again on the next tick.
      }
    }, 2000);
  }

  useEffect(() => {
    barqraftarService
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
    onError("");
    onNotice("");
    try {
      const job = await barqraftarService.syncNow();
      setSyncJob(job);
      startPolling();
    } catch (err) {
      onError(err.message || "Failed to sync with BarqRaftar");
    }
  }

  async function onCancelSync() {
    try {
      const job = await barqraftarService.cancelSync();
      setSyncJob(job);
      stopPolling();
      onNotice(`Sync cancelled - ${job.checked_count} shipment(s) checked before stopping.`);
    } catch (err) {
      onError(err.message || "Failed to cancel sync");
    }
  }

  async function copyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(status.webhook_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied - the URL is still selectable/visible
      // in the input below, so nothing else to do here.
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
        <div className="flex justify-between">
          <dt className="text-slate-500">Webhook</dt>
          <dd className="text-slate-800">
            {status.webhooks_active ? "Active" : "Not yet confirmed"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Events received</dt>
          <dd className="text-slate-800">{status.events_received_count}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Last event</dt>
          <dd className="text-slate-800">
            {status.last_event_at ? new Date(status.last_event_at).toLocaleString() : "Never"}
          </dd>
        </div>
      </dl>

      <div>
        <Button variant="secondary" className="w-full" loading={jobActive} onClick={onSyncNow} disabled={jobActive}>
          Sync statuses from BarqRaftar now
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
              <span>Last sync: checked {syncJob.checked_count}, updated {syncJob.updated_count}.</span>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Webhook URL</label>
        <div className="flex gap-2">
          <input
            readOnly
            value={status.webhook_url || ""}
            onClick={(e) => e.target.select()}
            className="w-full rounded-md border border-surface-border bg-slate-50 px-3 py-2 text-xs text-slate-600"
          />
          <Button variant="secondary" onClick={copyWebhookUrl}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          BarqRaftar has no self-service webhook setup - email this URL to support@barqraftar.pk to
          register it. Statuses still update automatically every few minutes via Sync now until then.
        </p>
      </div>

      <Button variant="danger" className="w-full" loading={disconnecting} onClick={handleDisconnect}>
        Disconnect
      </Button>
    </div>
  );
}
