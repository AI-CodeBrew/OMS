"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Button from "../../../../components/shared/Button";
import integrationsService from "../../../../services/integrationsService";

// Mirrors Smartlane's KYC field list, in their order.
const KYC_FIELDS = [
  { key: "name", label: "Business name", required: true },
  { key: "logo_url", label: "Logo URL", type: "url", placeholder: "https://…" },
  { key: "industry", label: "Industry", required: true },
  { key: "ntn", label: "NTN" },
  { key: "years_in_business", label: "Years in business", type: "number" },
  { key: "business_address", label: "Business address", required: true, wide: true },
  { key: "avg_order_value", label: "Average order value", type: "number" },
  { key: "avg_monthly_sales", label: "Average monthly sales", type: "number" },
  { key: "annual_retail_sales", label: "Annual retail sales (approx.)", type: "number" },
  { key: "poc_name", label: "Contact person", required: true },
  { key: "email", label: "Contact email", type: "email", required: true },
  { key: "phone", label: "Contact phone", required: true },
];

const STATUS_TONE = {
  pending_approval: "bg-amber-50 text-amber-700",
  in_review: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  in_active: "bg-slate-100 text-slate-600",
  draft: "bg-slate-100 text-slate-600",
};

const STATUS_BLURB = {
  pending_approval: "Submitted. Waiting for the platform team to review it.",
  in_review: "Approved here and sent to Smartlane, who are running their own review.",
  active: "Live. You can book orders through the couriers below.",
  rejected: "Not approved. See the reason below, fix it and submit again.",
  in_active: "Smartlane has this store marked inactive. Contact the platform team.",
};

const inputClass =
  "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

export default function OmsCourierPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await integrationsService.getOmsCourierOnboarding();
      setData(result);
      if (result.link) {
        setForm(
          Object.fromEntries(
            Object.entries(result.link.kyc || {}).map(([k, v]) => [k, v ?? ""]),
          ),
        );
        setSelected(result.link.requested_offerings || []);
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
  // Only these two states are the org's to act on; anything else is with a
  // reviewer and the form is read-only.
  const editable = !status || status === "draft" || status === "rejected";

  function toggleCourier(key) {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await integrationsService.submitOmsCourierOnboarding({
        ...form,
        platform: "api",
        requested_offerings: selected,
      });
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
          Book through the platform&apos;s own Smartlane account — no Smartlane signup of your
          own. Pick your couriers, send your business details, and the platform team reviews
          the request.
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
            The platform hasn&apos;t finished setting up its Smartlane business account. Check
            back later, or ask the platform team.
          </p>
        </div>
      ) : (
        <>
          {status ? (
            <div className="mt-6 rounded-lg border border-surface-border bg-white p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_TONE[status] || "bg-slate-100 text-slate-600"
                  }`}
                >
                  {link.status_display}
                </span>
                {link.smartlane_store_id ? (
                  <span className="text-xs text-slate-500">
                    Store ID <span className="font-mono">{link.smartlane_store_id}</span>
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-slate-600">{STATUS_BLURB[status]}</p>
              {status === "rejected" && link.review_note ? (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  <span className="font-medium">Reason:</span> {link.review_note}
                </p>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div className="rounded-lg border border-surface-border bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Couriers</h2>
              <p className="mt-1 text-xs text-slate-500">
                Pick the carriers you want to ship with.
              </p>
              {data.couriers.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  None available yet — the platform team hasn&apos;t published any couriers.
                </p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.couriers.map((c) => (
                    <label
                      key={c.key}
                      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${
                        selected.includes(c.key)
                          ? "border-brand-600 bg-brand-50"
                          : "border-surface-border bg-white"
                      } ${editable ? "cursor-pointer" : "cursor-default opacity-70"}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        disabled={!editable}
                        checked={selected.includes(c.key)}
                        onChange={() => toggleCourier(c.key)}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-800">{c.label}</span>
                        <span className="block text-xs text-slate-500">{c.service_type}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-surface-border bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Business details</h2>
              <p className="mt-1 text-xs text-slate-500">
                Smartlane needs these to open a store for you.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {KYC_FIELDS.map((f) => (
                  <label key={f.key} className={`block text-sm ${f.wide ? "sm:col-span-2" : ""}`}>
                    <span className="mb-1 block text-xs font-medium text-slate-700">
                      {f.label}
                      {f.required ? <span className="text-red-500"> *</span> : null}
                    </span>
                    <input
                      type={f.type || "text"}
                      required={f.required}
                      disabled={!editable}
                      placeholder={f.placeholder}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
                    />
                  </label>
                ))}
              </div>
            </div>

            {editable ? (
              <div className="flex justify-end">
                <Button type="submit" loading={saving} disabled={selected.length === 0}>
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
