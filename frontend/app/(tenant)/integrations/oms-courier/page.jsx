"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "../../../../components/shared/Button";
import integrationsService from "../../../../services/integrationsService";

// Mirrors Smartlane's real KYC request shape (from their Postman
// collection, not the doc's prose field list - the doc omitted city,
// state and CNIC entirely, and used different field names/order).
// Nothing on this page names Smartlane - to the org this is OMS Courier.
const KYC_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "logo_url", label: "Logo Url", type: "url", placeholder: "https://…" },
  {
    key: "platform",
    label: "Platform",
    required: true,
    type: "select",
    options: [
      { value: "api", label: "Api" },
      { value: "shopify", label: "Shopify" },
      { value: "wordpress", label: "Wordpress" },
    ],
  },
  { key: "industry", label: "Industry", required: true },
  { key: "ntn", label: "NTN" },
  { key: "business_years", label: "No. of years in business", type: "number" },
  { key: "address", label: "Business address", required: true, wide: true },
  { key: "city", label: "City", required: true },
  { key: "state", label: "State", required: true },
  { key: "avg_order_value", label: "Avg order value", type: "number" },
  { key: "avg_monthly_sale", label: "Avg monthly sales", type: "number" },
  { key: "annual_retail_sale", label: "Annual retail sale (Approx.)", type: "number" },
  { key: "poc_name", label: "Poc Name", required: true },
  { key: "poc_email", label: "Email", type: "email", required: true },
  { key: "poc_phone", label: "Phone", required: true },
  { key: "poc_cnic", label: "CNIC", required: true },
];

const STATUS_TONE = {
  pending_approval: "bg-amber-50 text-amber-700",
  in_review: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  in_active: "bg-slate-100 text-slate-600",
  draft: "bg-slate-100 text-slate-600",
};

// Our own labels rather than the backend's status_display, which names
// Smartlane ("In review with Smartlane").
const STATUS_LABEL = {
  pending_approval: "Pending approval",
  in_review: "In review",
  active: "Active",
  rejected: "Rejected",
  in_active: "Inactive",
  draft: "Draft",
};

const STATUS_BLURB = {
  pending_approval: "Submitted. Waiting for the platform team to review it.",
  in_review: "Your details are being reviewed. The platform team will activate your account once it clears.",
  active: "Live. On the Orders page, pick OMS Courier when assigning a courier to book through it.",
  rejected: "Not approved. See the reason below, fix it and submit again.",
  in_active: "This account is currently inactive. Contact the platform team.",
};

// Same convention as the Shopify integration page's sync job polling.
const ACTIVE_JOB_STATUSES = new Set(["pending", "running"]);

const inputClass =
  "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

function StatRow({ label, children }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{children}</span>
    </div>
  );
}

export default function OmsCourierPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ platform: "api" });
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
      if (result.link) {
        const kyc = Object.fromEntries(
          Object.entries(result.link.kyc || {}).map(([k, v]) => [k, v ?? ""]),
        );
        setForm({ ...kyc, platform: kyc.platform || "api" });
      } else {
        setForm({ platform: "api" });
      }
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

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await integrationsService.submitOmsCourierOnboarding(form);
      setNotice("Request submitted. The platform team will review it.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to submit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Link
        href="/integrations"
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        ← Integrations
      </Link>

      <div className="mt-3">
        <h1 className="text-[28px] font-semibold leading-8 text-slate-900">OMS Courier</h1>
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

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <details className="group rounded-lg border border-surface-border bg-white p-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Business details</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    We need these to set up your courier account.
                  </p>
                </div>
                <span className="-rotate-90 shrink-0 text-slate-400 transition-transform group-open:rotate-0">▾</span>
              </summary>
              <div className="mt-3 grid gap-4 border-t border-surface-border pt-4 sm:grid-cols-2">
                {KYC_FIELDS.map((f) => (
                  <label key={f.key} className={`block text-sm ${f.wide ? "sm:col-span-2" : ""}`}>
                    <span className="mb-1 block text-xs font-medium text-slate-700">
                      {f.label}
                      {f.required ? <span className="text-red-500"> *</span> : null}
                    </span>
                    {f.type === "select" ? (
                      <select
                        required={f.required}
                        disabled={!editable}
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
                      >
                        {f.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type || "text"}
                        required={f.required}
                        disabled={!editable}
                        placeholder={f.placeholder}
                        value={form[f.key] ?? ""}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
                      />
                    )}
                  </label>
                ))}
              </div>
            </details>

            {editable ? (
              <div className="flex justify-end">
                <Button type="submit" loading={saving}>
                  {status === "rejected" ? "Resubmit request" : "Submit request"}
                </Button>
              </div>
            ) : null}
          </form>
        </>
      )}
    </div>
  );
}
