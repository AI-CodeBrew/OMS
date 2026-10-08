"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../../../../../components/shared/Button";
import postexService from "../_lib/postexService";

const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);

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
        const job = await postexService.getSyncJobStatus();
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
    postexService
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
    if (!window.confirm("Sync shipment statuses from PostEx now?")) return;
    onError("");
    onNotice("");
    try {
      const job = await postexService.syncNow();
      setSyncJob(job);
      startPolling();
    } catch (err) {
      onError(err.message || "Failed to sync with PostEx");
    }
  }

  async function onCancelSync() {
    if (!window.confirm("Stop the sync? Shipments already updated are kept.")) return;
    try {
      const job = await postexService.cancelSync();
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
        {status.merchant_name ? (
          <div className="flex justify-between">
            <dt className="text-slate-500">PostEx account</dt>
            <dd className="text-slate-800">{status.merchant_name}</dd>
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
          Sync statuses from PostEx now
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
          PostEx has no webhooks - order statuses (picked up, out for delivery, delivered, returned) are pulled
          from PostEx automatically every few minutes. Use this button to pull them right now.
        </p>
      </div>

      <Button variant="danger" className="w-full" loading={disconnecting} onClick={handleDisconnect}>
        Disconnect
      </Button>
    </div>
  );
}
