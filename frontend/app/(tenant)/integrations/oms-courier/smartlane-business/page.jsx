"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "../../../../../components/shared/Button";
import integrationsService from "../../../../../services/integrationsService";
import SmartlaneBusinessForm, {
  STATUS_BLURB,
  STATUS_LABEL,
  STATUS_TONE,
} from "../_components/SmartlaneBusinessForm";

// Same convention as the Shopify integration page's sync job polling.
const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);

function StatRow({ label, children }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{children}</span>
    </div>
  );
}

export default function OmsCourierSmartlaneBusinessPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await integrationsService.getOmsCourierOnboarding();
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const link = data?.link;
  const status = link?.status;
  const live = Boolean(data?.live);
  const courier = data?.courier;
  // The courier side can mark the store active before the platform team
  // has approved it here with credentials - to the org that's still in review.
  const displayStatus = live ? "active" : status === "active" ? "in_review" : status;
  // Only these two states are the org's to act on; anything else is with a
  // reviewer and the form is read-only.
  const editable = !status || status === "draft" || status === "rejected";

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSyncing(false);
  }

  // Same 2-second polling pattern as the Shopify integration page.
  function startPolling() {
    if (pollRef.current) return;
    setSyncing(true);
    pollRef.current = setInterval(async () => {
      try {
        const job = await integrationsService.getSmartlaneSyncJobStatus();
        setSyncJob(job);
        if (!ACTIVE_JOB_STATUSES.has(job.status)) {
          stopPolling();
          if (job.status === "completed") {
            setNotice(`Sync finished: checked ${job.checked_count}, updated ${job.updated_count}.`);
            await load();
          } else if (job.status === "failed") {
            setError(job.error_message || "Sync failed");
          } else if (job.status === "cancelled") {
            setNotice(`Sync cancelled — ${job.checked_count} order(s) checked before stopping.`);
          }
        }
      } catch {
        // Transient poll failure - just try again on the next tick.
      }
    }, 2000);
  }

  // Resume polling if a sync was already running (e.g. page refresh mid-sync).
  useEffect(() => {
    if (!live) return undefined;
    integrationsService
      .getSmartlaneSyncJobStatus()
      .then((job) => {
        setSyncJob(job);
        if (job && ACTIVE_JOB_STATUSES.has(job.status)) startPolling();
      })
      .catch(() => {});
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  async function onSyncNow() {
    if (!window.confirm("Sync order statuses from OMS Courier now?")) return;
    setError("");
    setNotice("");
    try {
      const job = await integrationsService.syncSmartlane();
      setSyncJob(job);
      startPolling();
    } catch (err) {
      setError(err.message || "Failed to start sync");
    }
  }

  async function onCancelSync() {
    if (!window.confirm("Stop the sync? Orders already updated are kept.")) return;
    try {
      const job = await integrationsService.cancelSmartlaneSync();
      setSyncJob(job);
      stopPolling();
      setNotice(`Sync cancelled — ${job.checked_count} order(s) checked before stopping.`);
    } catch (err) {
      setError(err.message || "Failed to cancel sync");
    }
  }

  async function onSubmitted() {
    setNotice("Request submitted. The platform team will review it.");
    await load();
  }

  function onFormError(message) {
    setError(message);
    setNotice("");
  }

  return (
    <div>
      <Link
        href="/integrations/oms-courier"
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        ← OMS Courier
      </Link>

      <div className="mt-3">
        <h1 className="text-[28px] font-semibold leading-8 text-slate-900">
          OMS Courier · Smartlane Business
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Book shipments through the platform&apos;s own courier account — no separate courier
          signup needed. Send your business details and the platform team reviews the request.
        </p>
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : !data?.available ? (
        <div className="mt-6 rounded-lg border border-surface-border bg-white p-6">
          <p className="text-sm font-medium text-slate-800">Not available yet</p>
          <p className="mt-1 text-sm text-slate-500">
            The platform hasn&apos;t finished setting up OMS Courier. Check back later, or ask
            the platform team.
          </p>
        </div>
      ) : (
        <>
          {displayStatus ? (
            <div className="mt-6 rounded-lg border border-surface-border bg-white p-5">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  STATUS_TONE[displayStatus] || "bg-slate-100 text-slate-600"
                }`}
              >
                {STATUS_LABEL[displayStatus] || displayStatus}
              </span>
              <p className="mt-2 text-sm text-slate-600">{STATUS_BLURB[displayStatus]}</p>
              {status === "rejected" && link.review_note ? (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  <span className="font-medium">Reason:</span> {link.review_note}
                </p>
              ) : null}
            </div>
          ) : null}

          {live && courier ? (
            <div className="mt-4 rounded-lg border border-surface-border bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Connection</h2>
              <div className="mt-3 space-y-2 text-sm">
                <StatRow label="Warehouse code">
                  <span className="font-mono">{courier.store_warehouse_code || "—"}</span>
                </StatRow>
                <StatRow label="Live tracking updates">
                  {courier.webhooks_active ? "Active" : "Waiting for the first update"}
                </StatRow>
                <StatRow label="Updates received">{courier.events_received_count ?? 0}</StatRow>
                <StatRow label="Last update">
                  {courier.last_event_at ? new Date(courier.last_event_at).toLocaleString() : "Never"}
                </StatRow>
              </div>

              <div className="mt-4 border-t border-surface-border pt-4">
                <Button variant="secondary" onClick={onSyncNow} loading={syncing}>
                  Sync statuses now
                </Button>
                <span className="mt-1 block text-xs text-slate-400">
                  Checks every order still in progress and applies what comes back - tracking
                  numbers for Booking Pending orders, and delivered / returned outcomes.
                </span>

                {syncing && syncJob ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">
                        Syncing… {syncJob.checked_count}
                        {syncJob.total_available != null ? ` of ${syncJob.total_available}` : ""}{" "}
                        order{syncJob.checked_count === 1 ? "" : "s"} checked
                        {syncJob.updated_count ? `, ${syncJob.updated_count} updated` : ""}
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
                              (syncJob.checked_count / syncJob.total_available) * 100,
                              100,
                            )}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-4">
            <details className="group rounded-lg border border-surface-border bg-white p-5" open={editable || undefined}>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Business details</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    We need these to set up your courier account. Fields marked * are required.
                  </p>
                </div>
                <span className="-rotate-90 shrink-0 text-slate-400 transition-transform group-open:rotate-0">▾</span>
              </summary>
              <div className="mt-3 border-t border-surface-border pt-4">
                <SmartlaneBusinessForm
                  formId="smartlane-business-form"
                  initialKyc={link?.kyc}
                  editable={editable}
                  onSubmitted={onSubmitted}
                  onError={onFormError}
                  onSavingChange={setSaving}
                />
              </div>
            </details>

            {editable ? (
              <div className="flex justify-end">
                <Button type="submit" form="smartlane-business-form" loading={saving}>
                  {status === "rejected" ? "Resubmit request" : "Submit request"}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
