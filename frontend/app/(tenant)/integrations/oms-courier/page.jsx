"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "../../../../components/shared/Button";
import integrationsService from "../../../../services/integrationsService";

// Mirrors Smartlane's real KYC request shape (from their Postman
// collection, not the doc's prose field list - the doc omitted city,
// state and CNIC entirely, and used different field names/order).
// Nothing on this page names Smartlane - to the org this is OMS Courier.
// Grouped into sections so the form reads top to bottom; `kind` drives the
// input, its clean-up as the user types, and its check before submit (the
// backend repeats every check - see business_services._clean_kyc_fields).
const KYC_SECTIONS = [
  {
    title: "Business",
    fields: [
      { key: "name", label: "Business name", required: true, placeholder: "e.g. Halora" },
      {
        key: "industry",
        label: "Industry",
        required: true,
        kind: "industry",
        hint: "Only these industries are accepted by the courier.",
      },
      {
        key: "platform",
        label: "Platform",
        required: true,
        kind: "select",
        options: [
          { value: "api", label: "Api" },
          { value: "shopify", label: "Shopify" },
          { value: "wordpress", label: "Wordpress" },
        ],
      },
      {
        key: "business_years",
        label: "Years in business",
        kind: "number",
        integer: true,
        placeholder: "e.g. 2",
      },
      {
        key: "ntn",
        label: "NTN",
        kind: "ntn",
        placeholder: "1234567-8",
        hint: "Optional. 8 digits - the dash is added for you.",
      },
      {
        key: "logo_url",
        label: "Logo URL",
        kind: "url",
        placeholder: "https://…",
        hint: "Optional. A full link to your logo image.",
      },
    ],
  },
  {
    title: "Address",
    fields: [
      { key: "address", label: "Business address", required: true, wide: true, placeholder: "Plot, street, area" },
      { key: "city", label: "City", required: true, kind: "city", hint: "Start typing and pick from the list." },
      { key: "state", label: "Province", required: true, kind: "state" },
    ],
  },
  {
    title: "Contact person",
    fields: [
      { key: "poc_name", label: "Full name", required: true },
      { key: "poc_email", label: "Email", required: true, kind: "email", placeholder: "name@example.com" },
      {
        key: "poc_phone",
        label: "Mobile number",
        required: true,
        kind: "phone",
        placeholder: "03001234567",
        hint: "11 digits starting with 03. +92 numbers are converted for you.",
      },
      {
        key: "poc_cnic",
        label: "CNIC",
        required: true,
        kind: "cnic",
        placeholder: "3520212345671",
        hint: "13 digits without dashes - dashes are removed for you.",
      },
    ],
  },
  {
    title: "Sales (approximate, in PKR)",
    fields: [
      { key: "avg_order_value", label: "Average order value", kind: "number", placeholder: "e.g. 2500" },
      { key: "avg_monthly_sale", label: "Average monthly sales", kind: "number", placeholder: "e.g. 500000" },
      { key: "annual_retail_sale", label: "Annual retail sales", kind: "number", placeholder: "e.g. 6000000" },
    ],
  },
];

const KYC_FIELDS = KYC_SECTIONS.flatMap((s) => s.fields);

// Used if the options endpoint can't be reached - same list the backend
// validates against.
const FALLBACK_STATES = [
  "Punjab",
  "Sindh",
  "Khyber Pakhtunkhwa",
  "Balochistan",
  "Islamabad Capital Territory",
  "Gilgit-Baltistan",
  "Azad Jammu & Kashmir",
];

const digitsOnly = (value) => String(value ?? "").replace(/\D/g, "");

// "+92 300 1234567" / "923001234567" / "3001234567" -> "03001234567", or ""
// if it can't be made into a Pakistani mobile number.
function normalizePhone(value) {
  let d = digitsOnly(value);
  if (d.startsWith("0092")) d = d.slice(4);
  else if (d.startsWith("92") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("3")) d = `0${d}`;
  return /^03\d{9}$/.test(d) ? d : "";
}

// 8 digits -> "1234567-8" (the courier's own sample format); 7 or 13 kept.
function normalizeNtn(value) {
  const d = digitsOnly(value);
  if (d.length === 8) return `${d.slice(0, 7)}-${d.slice(7)}`;
  if (d.length === 7 || d.length === 13) return d;
  return "";
}

function sameText(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

// Cleans a value as it's typed, so the field never holds something the
// courier won't take (dashes in a CNIC, letters in a phone number, ...).
function cleanWhileTyping(field, value) {
  if (field.kind === "cnic") return digitsOnly(value).slice(0, 13);
  if (field.kind === "phone") return String(value).replace(/[^\d+\s-]/g, "").slice(0, 16);
  if (field.kind === "ntn") return String(value).replace(/[^\d-]/g, "").slice(0, 15);
  return value;
}

// Tidies a value once the user leaves the field.
function cleanOnBlur(field, value) {
  if (field.kind === "phone") return normalizePhone(value) || value;
  if (field.kind === "ntn") return normalizeNtn(value) || value;
  if (typeof value === "string" && field.kind !== "industry") return value.trim();
  return value;
}

function validateField(field, value, options) {
  const text = String(value ?? "").trim();
  if (!text) return field.required ? "Required." : "";
  switch (field.kind) {
    case "industry":
      return options.industries.length && !options.industries.some((i) => i === value)
        ? "Pick an industry from the list."
        : "";
    case "state":
      return options.states.includes(value) ? "" : "Pick a province from the list.";
    case "cnic":
      return /^\d{13}$/.test(text) ? "" : `CNIC must be 13 digits (you have ${digitsOnly(text).length}).`;
    case "phone":
      return normalizePhone(text) ? "" : "Enter a mobile number like 03001234567.";
    case "ntn":
      return normalizeNtn(text) ? "" : "NTN must be like 1234567-8.";
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? "" : "Enter a valid email address.";
    case "url":
      return /^https?:\/\/\S+\.\S+/.test(text) ? "" : "Must be a full link starting with https://.";
    case "number": {
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) return "Enter a number (0 or more).";
      if (field.integer && !Number.isInteger(n)) return "Enter a whole number.";
      return "";
    }
    default:
      return "";
  }
}

// What actually gets sent - every value in the exact shape the courier wants.
function cleanForSubmit(form) {
  const out = { ...form };
  for (const field of KYC_FIELDS) {
    const value = out[field.key];
    if (value === undefined || value === null) continue;
    if (field.kind === "cnic") out[field.key] = digitsOnly(value);
    else if (field.kind === "phone") out[field.key] = normalizePhone(value) || value;
    else if (field.kind === "ntn") out[field.key] = value ? normalizeNtn(value) || value : "";
    else if (typeof value === "string" && field.kind !== "industry") out[field.key] = value.trim();
  }
  return out;
}

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

const INPUT_TYPE = { email: "email", url: "url", number: "number" };

function KycField({ field, value, options, editable, error, onChange, onBlur }) {
  const cls = `${inputClass} disabled:bg-slate-50 disabled:text-slate-500 ${
    error ? "border-red-400 focus:border-red-500" : ""
  }`;
  const current = value ?? "";
  let control;

  if (!editable) {
    // Read-only once submitted - plain text, even for the dropdown fields.
    const shown =
      field.kind === "select"
        ? field.options.find((o) => o.value === current)?.label || current
        : String(current).trim();
    control = <input disabled value={shown} className={cls} />;
  } else if (field.kind === "select") {
    control = (
      <select value={current} onChange={(e) => onChange(e.target.value)} className={cls}>
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  } else if ((field.kind === "industry" && options.industries.length) || field.kind === "state") {
    const list = field.kind === "industry" ? options.industries : options.states;
    // A saved value that isn't in the list (typed before this was a
    // dropdown) stays visible, flagged, instead of silently changing.
    const unknown = current && !list.includes(current);
    control = (
      <select value={current} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="" disabled>
          {field.kind === "industry" ? "Select an industry…" : "Select a province…"}
        </option>
        {unknown ? <option value={current}>{`${String(current).trim()} (not accepted - pick another)`}</option> : null}
        {list.map((item) => (
          <option key={item} value={item}>
            {item.trim()}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        type={INPUT_TYPE[field.kind] || "text"}
        inputMode={field.kind === "cnic" ? "numeric" : field.kind === "phone" ? "tel" : undefined}
        list={field.kind === "city" ? "oms-courier-city-options" : undefined}
        min={field.kind === "number" ? 0 : undefined}
        step={field.kind === "number" ? (field.integer ? 1 : "any") : undefined}
        placeholder={field.placeholder}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cls}
        autoComplete="off"
      />
    );
  }

  const cnicCount =
    editable && field.kind === "cnic" && current ? ` ${String(current).length}/13 digits.` : "";

  return (
    <label className={`block text-sm ${field.wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {field.label}
        {field.required ? <span className="text-red-500"> *</span> : null}
      </span>
      {control}
      {field.kind === "city" && editable ? (
        <datalist id="oms-courier-city-options">
          {options.cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      ) : null}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : editable && (field.hint || cnicCount) ? (
        <span className="mt-1 block text-xs text-slate-400">
          {field.hint}
          {cnicCount}
        </span>
      ) : null}
    </label>
  );
}

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
  const [options, setOptions] = useState({ industries: [], cities: [], states: FALLBACK_STATES });
  // Field errors only show after the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
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
  const available = Boolean(data?.available);

  // The dropdown lists are only needed while the form can be edited.
  useEffect(() => {
    if (!editable || !available) return undefined;
    let cancelled = false;
    integrationsService
      .getOmsCourierKycOptions()
      .then((opts) => {
        if (cancelled) return;
        const next = {
          industries: opts.industries || [],
          cities: opts.cities || [],
          states: opts.states?.length ? opts.states : FALLBACK_STATES,
        };
        setOptions(next);
        // A value saved before these were dropdowns ("fashion", "punjab")
        // snaps to the listed spelling, so the dropdown shows it.
        setForm((f) => {
          const industry = next.industries.find((i) => sameText(i, f.industry));
          const state = next.states.find((s) => sameText(s, f.state));
          return { ...f, ...(industry ? { industry } : {}), ...(state ? { state } : {}) };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editable, available]);

  const fieldErrors = Object.fromEntries(
    KYC_FIELDS.map((f) => [f.key, validateField(f, form[f.key], options)])
  );

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
    if (KYC_FIELDS.some((f) => fieldErrors[f.key])) {
      setShowErrors(true);
      setNotice("");
      setError("Please fix the highlighted fields below.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await integrationsService.submitOmsCourierOnboarding(cleanForSubmit(form));
      setShowErrors(false);
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

          <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
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
              <div className="mt-3 space-y-6 border-t border-surface-border pt-4">
                {KYC_SECTIONS.map((section) => (
                  <fieldset key={section.title}>
                    <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {section.title}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {section.fields.map((f) => (
                        <KycField
                          key={f.key}
                          field={f}
                          value={form[f.key]}
                          options={options}
                          editable={editable}
                          error={showErrors ? fieldErrors[f.key] : ""}
                          onChange={(value) => setForm((prev) => ({ ...prev, [f.key]: cleanWhileTyping(f, value) }))}
                          onBlur={() => setForm((prev) => ({ ...prev, [f.key]: cleanOnBlur(f, prev[f.key] ?? "") }))}
                        />
                      ))}
                    </div>
                  </fieldset>
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
