"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Button from "../../../../components/shared/Button";
import integrationsService from "../../../../services/integrationsService";

// Mirrors Smartlane's real KYC request shape (from their Postman
// collection, not the doc's prose field list - the doc omitted city,
// state and CNIC entirely, and used different field names/order).
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
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  in_active: "bg-slate-100 text-slate-600",
  draft: "bg-slate-100 text-slate-600",
};

const SHIP_ACTIONS = [
  { value: "consignment_create", label: "Create consignment" },
  { value: "consignment_track", label: "Track consignment" },
  { value: "consignment_cancel", label: "Cancel consignment" },
  { value: "airway_bill", label: "Airway bill" },
  { value: "load_sheet", label: "Load sheet" },
  { value: "shipper_advice_get", label: "Shipper advice (get)" },
  { value: "shipper_advice_update", label: "Shipper advice (update)" },
];

const STATUS_BLURB = {
  pending_approval: "Submitted. Waiting for the platform team to review it.",
  in_review: "Approved here and sent to Smartlane, who are running their own review.",
  active: "Live. The platform team has activated your Smartlane store.",
  rejected: "Not approved. See the reason below, fix it and submit again.",
  in_active: "Smartlane has this store marked inactive. Contact the platform team.",
};

const inputClass =
  "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

export default function OmsCourierPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ platform: "api" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Webhook / warehouse-edit / finance requests - all loaded together,
  // split by request_type when rendered.
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);

  const [webhookForm, setWebhookForm] = useState({ url: "", type: "" });

  const [warehouses, setWarehouses] = useState([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [warehouseEditId, setWarehouseEditId] = useState(null);
  const [warehouseForm, setWarehouseForm] = useState({});

  const [financeProducts, setFinanceProducts] = useState(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeCode, setFinanceCode] = useState("");

  const [shipAction, setShipAction] = useState("consignment_track");
  const [shipStoreOrderIds, setShipStoreOrderIds] = useState("");
  const [shipStoreOrderId, setShipStoreOrderId] = useState("");
  const [shipBody, setShipBody] = useState("");
  const [shipExtra, setShipExtra] = useState({});
  const [shipBusy, setShipBusy] = useState(false);
  const [shipResult, setShipResult] = useState(null);

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
  // Only these two states are the org's to act on; anything else is with a
  // reviewer and the form is read-only.
  const editable = !status || status === "draft" || status === "rejected";
  const isLive = status === "active";

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const result = await integrationsService.getOmsCourierRequests();
      setRequests(result.requests || []);
    } catch (err) {
      setError(err.message || "Failed to load requests");
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  const loadWarehouses = useCallback(async () => {
    setWarehousesLoading(true);
    try {
      const result = await integrationsService.getOmsCourierWarehouses();
      setWarehouses(result.warehouses || []);
    } catch (err) {
      setError(err.message || "Failed to load warehouses");
    } finally {
      setWarehousesLoading(false);
    }
  }, []);

  const loadFinanceProducts = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const result = await integrationsService.getOmsCourierFinance();
      setFinanceProducts(result.products);
    } catch (err) {
      setError(err.message || "Failed to load finance products");
    } finally {
      setFinanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLive) return;
    loadRequests();
    loadWarehouses();
    loadFinanceProducts();
  }, [isLive, loadRequests, loadWarehouses, loadFinanceProducts]);

  async function onSubmitWebhook(e) {
    e.preventDefault();
    if (!webhookForm.url.trim() || !webhookForm.type.trim()) {
      setError("Webhook URL and type are both required.");
      return;
    }
    setRequestBusy(true);
    setError("");
    setNotice("");
    try {
      await integrationsService.submitOmsCourierRequest("webhook", {
        url: webhookForm.url.trim(),
        type: webhookForm.type.trim(),
      });
      setNotice("Webhook request submitted. The platform team will review it.");
      setWebhookForm({ url: "", type: "" });
      await loadRequests();
    } catch (err) {
      setError(err.message || "Failed to submit webhook request");
    } finally {
      setRequestBusy(false);
    }
  }

  function onStartWarehouseEdit(wh) {
    setWarehouseEditId(wh.id);
    setWarehouseForm({
      name: wh.name || "",
      shipper_name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      area: "",
      zip_code: "",
      service_type: "",
      auto_booking: true,
    });
  }

  async function onSubmitWarehouseEdit(action) {
    setRequestBusy(true);
    setError("");
    setNotice("");
    try {
      await integrationsService.submitOmsCourierRequest("warehouse_edit", {
        warehouse_id: warehouseEditId,
        action,
        ...warehouseForm,
      });
      setNotice(action === "revoke" ? "Revoke request submitted." : "Edit request submitted.");
      setWarehouseEditId(null);
      await loadRequests();
    } catch (err) {
      setError(err.message || "Failed to submit warehouse request");
    } finally {
      setRequestBusy(false);
    }
  }

  async function onApplyFinance() {
    if (!financeCode.trim()) {
      setError("Enter the finance product code to apply for.");
      return;
    }
    setRequestBusy(true);
    setError("");
    setNotice("");
    try {
      await integrationsService.submitOmsCourierRequest("finance", { product_code: financeCode.trim() });
      setNotice("Finance application submitted. The platform team will review it.");
      setFinanceCode("");
      await loadRequests();
    } catch (err) {
      setError(err.message || "Failed to submit finance application");
    } finally {
      setRequestBusy(false);
    }
  }

  async function onRunShipmentAction() {
    let params = {};
    try {
      if (shipAction === "consignment_create") {
        params = { body: shipBody.trim() ? JSON.parse(shipBody) : {} };
      } else if (shipAction === "consignment_track") {
        params = { store_order_ids: shipStoreOrderIds.split(",").map((s) => s.trim()).filter(Boolean) };
      } else if (shipAction === "consignment_cancel") {
        params = { store_order_id: shipStoreOrderId.trim() };
      } else if (shipAction === "airway_bill") {
        params = {
          store_order_ids: shipStoreOrderIds.split(",").map((s) => s.trim()).filter(Boolean),
          no_of_prints: Number(shipExtra.no_of_prints) || 1,
        };
      } else if (shipAction === "load_sheet") {
        params = {
          courier: shipExtra.courier || undefined,
          store_order_ids: shipStoreOrderIds.trim()
            ? shipStoreOrderIds.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
          start_date: shipExtra.start_date || undefined,
          end_date: shipExtra.end_date || undefined,
        };
      } else if (shipAction === "shipper_advice_update") {
        params = { body: shipBody.trim() ? JSON.parse(shipBody) : {} };
      }
    } catch {
      setError("Body must be valid JSON.");
      return;
    }

    setShipBusy(true);
    setError("");
    setShipResult(null);
    try {
      const data = await integrationsService.runOmsCourierShipmentAction(shipAction, params);
      setShipResult(data.result);
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setShipBusy(false);
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
          Book through the platform&apos;s own Smartlane account — no Smartlane signup of your
          own. Send your business details and the platform team reviews the request.
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
            <details className="group rounded-lg border border-surface-border bg-white p-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Business details</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Smartlane needs these to open a store for you.
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

          {isLive ? (
            <>
              <div className="mt-6 rounded-lg border border-surface-border bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">Webhook</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Register or update the webhook Smartlane calls for this store. Submitting sends
                  it to the platform team for review — nothing reaches Smartlane until approved.
                </p>
                <form onSubmit={onSubmitWebhook} className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-medium text-slate-700">Webhook URL</span>
                    <input
                      value={webhookForm.url}
                      onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
                      placeholder="https://…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-medium text-slate-700">Type</span>
                    <input
                      value={webhookForm.type}
                      onChange={(e) => setWebhookForm({ ...webhookForm, type: e.target.value })}
                      placeholder="e.g. status_update"
                      className={inputClass}
                    />
                  </label>
                  <Button type="submit" loading={requestBusy}>
                    Submit
                  </Button>
                </form>
                {requests.filter((r) => r.request_type === "webhook").length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {requests
                      .filter((r) => r.request_type === "webhook")
                      .map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-slate-600">
                            {r.payload?.type} · {r.payload?.url}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_TONE[r.status] || "bg-slate-100 text-slate-600"}`}>
                            {r.status_display}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-4 rounded-lg border border-surface-border bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">Warehouses</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Request a change or revoke for an already-provisioned warehouse. Also needs
                  platform-team approval before it reaches Smartlane.
                </p>
                {warehousesLoading ? (
                  <p className="mt-3 text-xs text-slate-500">Loading…</p>
                ) : warehouses.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">None provisioned yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {warehouses.map((wh) => (
                      <li key={wh.id} className="rounded-md border border-surface-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm text-slate-800">
                            {wh.name || wh.offering_label}
                            {wh.smartlane_warehouse_code ? (
                              <span className="ml-1.5 font-mono text-xs text-slate-500">{wh.smartlane_warehouse_code}</span>
                            ) : null}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[wh.status] || "bg-slate-100 text-slate-600"}`}>
                              {wh.status}
                            </span>
                            <Button variant="secondary" onClick={() => onStartWarehouseEdit(wh)}>
                              Edit
                            </Button>
                          </div>
                        </div>

                        {warehouseEditId === wh.id ? (
                          <div className="mt-3 space-y-2 border-t border-surface-border pt-3">
                            <div className="grid gap-2 sm:grid-cols-2">
                              {[
                                ["name", "Name"],
                                ["shipper_name", "Shipper name"],
                                ["email", "Email"],
                                ["phone", "Phone"],
                                ["address", "Address"],
                                ["city", "City"],
                                ["area", "Area"],
                                ["zip_code", "Zip code"],
                                ["service_type", "Service type (overnight/overland)"],
                              ].map(([key, label]) => (
                                <label key={key} className="block text-xs">
                                  <span className="mb-1 block text-slate-600">{label}</span>
                                  <input
                                    value={warehouseForm[key] || ""}
                                    onChange={(e) => setWarehouseForm({ ...warehouseForm, [key]: e.target.value })}
                                    className={`${inputClass} text-xs`}
                                  />
                                </label>
                              ))}
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button variant="secondary" onClick={() => setWarehouseEditId(null)}>
                                Cancel
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => onSubmitWarehouseEdit("revoke")}
                                loading={requestBusy}
                              >
                                Request revoke
                              </Button>
                              <Button onClick={() => onSubmitWarehouseEdit("edit")} loading={requestBusy}>
                                Request edit
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {requests.filter((r) => r.request_type === "warehouse_edit").length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {requests
                      .filter((r) => r.request_type === "warehouse_edit")
                      .map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-slate-600">
                            {r.payload?.action} request
                            {r.review_note ? <span className="text-red-600"> — {r.review_note}</span> : null}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_TONE[r.status] || "bg-slate-100 text-slate-600"}`}>
                            {r.status_display}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-4 rounded-lg border border-surface-border bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">Financing</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Available finance products for your store. Applying needs platform-team
                  approval before it reaches Smartlane.
                </p>
                {financeLoading ? (
                  <p className="mt-3 text-xs text-slate-500">Loading…</p>
                ) : financeProducts ? (
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    {JSON.stringify(financeProducts, null, 2)}
                  </pre>
                ) : null}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="block text-xs">
                    <span className="mb-1 block text-slate-600">Product code</span>
                    <input
                      value={financeCode}
                      onChange={(e) => setFinanceCode(e.target.value)}
                      className={`${inputClass} text-xs`}
                    />
                  </label>
                  <Button onClick={onApplyFinance} loading={requestBusy}>
                    Apply
                  </Button>
                </div>
                {requests.filter((r) => r.request_type === "finance").length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {requests
                      .filter((r) => r.request_type === "finance")
                      .map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-slate-600">{r.payload?.product_code}</span>
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_TONE[r.status] || "bg-slate-100 text-slate-600"}`}>
                            {r.status_display}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-4 rounded-lg border border-surface-border bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">Shipments</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Create, track and cancel consignments, and pull Airway Bill / Load Sheet /
                  Shipper Advise for this store. Direct — no review step.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-[220px_1fr]">
                  <label className="block text-xs">
                    <span className="mb-1 block text-slate-600">Action</span>
                    <select
                      value={shipAction}
                      onChange={(e) => {
                        setShipAction(e.target.value);
                        setShipResult(null);
                      }}
                      className={`${inputClass} text-xs`}
                    >
                      {SHIP_ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-wrap items-end gap-2">
                    {["consignment_track", "airway_bill", "load_sheet"].includes(shipAction) ? (
                      <label className="block text-xs">
                        <span className="mb-1 block text-slate-600">Store order IDs (comma-separated)</span>
                        <input
                          value={shipStoreOrderIds}
                          onChange={(e) => setShipStoreOrderIds(e.target.value)}
                          placeholder="SLTEST001, SLTEST002"
                          className={`${inputClass} w-64 text-xs`}
                        />
                      </label>
                    ) : null}
                    {shipAction === "consignment_cancel" ? (
                      <label className="block text-xs">
                        <span className="mb-1 block text-slate-600">Store order ID</span>
                        <input
                          value={shipStoreOrderId}
                          onChange={(e) => setShipStoreOrderId(e.target.value)}
                          className={`${inputClass} w-48 text-xs`}
                        />
                      </label>
                    ) : null}
                    {shipAction === "airway_bill" ? (
                      <label className="block text-xs">
                        <span className="mb-1 block text-slate-600"># of prints</span>
                        <input
                          value={shipExtra.no_of_prints || ""}
                          onChange={(e) => setShipExtra({ ...shipExtra, no_of_prints: e.target.value })}
                          className={`${inputClass} w-24 text-xs`}
                        />
                      </label>
                    ) : null}
                    {shipAction === "load_sheet" ? (
                      <>
                        <label className="block text-xs">
                          <span className="mb-1 block text-slate-600">Courier</span>
                          <input
                            value={shipExtra.courier || ""}
                            onChange={(e) => setShipExtra({ ...shipExtra, courier: e.target.value })}
                            className={`${inputClass} w-32 text-xs`}
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="mb-1 block text-slate-600">Start date</span>
                          <input
                            type="date"
                            value={shipExtra.start_date || ""}
                            onChange={(e) => setShipExtra({ ...shipExtra, start_date: e.target.value })}
                            className={`${inputClass} text-xs`}
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="mb-1 block text-slate-600">End date</span>
                          <input
                            type="date"
                            value={shipExtra.end_date || ""}
                            onChange={(e) => setShipExtra({ ...shipExtra, end_date: e.target.value })}
                            className={`${inputClass} text-xs`}
                          />
                        </label>
                      </>
                    ) : null}
                    {["consignment_create", "shipper_advice_update"].includes(shipAction) ? (
                      <label className="block w-full text-xs">
                        <span className="mb-1 block text-slate-600">Body (JSON)</span>
                        <textarea
                          rows={3}
                          value={shipBody}
                          onChange={(e) => setShipBody(e.target.value)}
                          placeholder="{}"
                          className={`${inputClass} w-full font-mono text-xs`}
                        />
                      </label>
                    ) : null}
                    <Button onClick={onRunShipmentAction} loading={shipBusy}>
                      Send
                    </Button>
                  </div>
                </div>

                {shipResult ? (
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    {JSON.stringify(shipResult, null, 2)}
                  </pre>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
