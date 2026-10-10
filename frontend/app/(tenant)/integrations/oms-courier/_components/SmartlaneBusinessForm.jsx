"use client";

import { useEffect, useState } from "react";
import integrationsService from "../../../../../services/integrationsService";

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

export const STATUS_TONE = {
  pending_approval: "bg-amber-50 text-amber-700",
  in_review: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  in_active: "bg-slate-100 text-slate-600",
  draft: "bg-slate-100 text-slate-600",
};

// Our own labels rather than the backend's status_display, which names
// Smartlane ("In review with Smartlane").
export const STATUS_LABEL = {
  pending_approval: "Pending approval",
  in_review: "In review",
  active: "Active",
  rejected: "Rejected",
  in_active: "Inactive",
  draft: "Draft",
};

export const STATUS_BLURB = {
  pending_approval: "Submitted. Waiting for the platform team to review it.",
  in_review: "Your details are being reviewed. The platform team will activate your account once it clears.",
  active: "Live. On the Orders page, pick OMS Courier when assigning a courier to book through it.",
  rejected: "Not approved. See the reason below, fix it and submit again.",
  in_active: "This account is currently inactive. Contact the platform team.",
};

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

// Form values from a saved request's kyc (or a blank one).
function toForm(kyc) {
  const values = Object.fromEntries(Object.entries(kyc || {}).map(([k, v]) => [k, v ?? ""]));
  return { ...values, platform: values.platform || "api" };
}

// The business-details form OMS Courier's Smartlane onboarding runs on -
// shared by the OMS Courier page's Smartlane dialog and the Smartlane
// Business page. Owns its values, dropdown lists and validation, and
// submits itself; the caller renders the submit button (form={formId}) and
// decides what happens around it.
export default function SmartlaneBusinessForm({
  formId,
  initialKyc,
  editable,
  onSubmitted,
  onError,
  onSavingChange,
}) {
  const [form, setForm] = useState(() => toForm(initialKyc));
  const [options, setOptions] = useState({ industries: [], cities: [], states: FALLBACK_STATES });
  // Field errors only show after the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);

  // A reload of the saved request replaces whatever was typed.
  useEffect(() => {
    setForm(toForm(initialKyc));
  }, [initialKyc]);

  // The dropdown lists are only needed while the form can be edited.
  useEffect(() => {
    if (!editable) return undefined;
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
          const state = next.states.find((st) => sameText(st, f.state));
          return { ...f, ...(industry ? { industry } : {}), ...(state ? { state } : {}) };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editable]);

  const fieldErrors = Object.fromEntries(
    KYC_FIELDS.map((f) => [f.key, validateField(f, form[f.key], options)])
  );

  async function onSubmit(e) {
    e.preventDefault();
    if (!editable) return;
    if (KYC_FIELDS.some((f) => fieldErrors[f.key])) {
      setShowErrors(true);
      onError?.("Please fix the highlighted fields below.");
      return;
    }
    onSavingChange?.(true);
    onError?.("");
    try {
      await integrationsService.submitOmsCourierOnboarding(cleanForSubmit(form));
      setShowErrors(false);
      await onSubmitted?.();
    } catch (err) {
      onError?.(err.message || "Failed to submit");
    } finally {
      onSavingChange?.(false);
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="space-y-6">
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
    </form>
  );
}
