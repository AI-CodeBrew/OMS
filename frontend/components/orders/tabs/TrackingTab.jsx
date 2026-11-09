"use client";

import { useEffect, useState } from "react";
import ordersService from "../../../services/ordersService";

import { formatDateTime } from "../../../lib/formatDate";
const CARRIER_LABELS = { leopards: "Leopards", barq_raftar: "Barq Raftar" };

// Smartlane's stages in pipeline order (SmartlaneShipment's time fields).
// Its "dispute" time is stored but not shown: Smartlane fills it on nearly
// every parcel, 5 hours before out_for_delivery, so it doesn't mean a
// dispute was raised.
const STAGES = [
  ["queued_at", "Queued"],
  ["ready_at", "Ready"],
  ["dispatched_at", "Dispatched"],
  ["out_for_delivery_at", "Out for Delivery"],
  ["attempted_at", "Attempted"],
  ["return_in_progress_at", "Return in Progress"],
  ["completed_at", "Delivered"],
  ["returned_at", "Returned"],
  ["cancelled_at", "Cancelled"],
];

function readable(value) {
  return (value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function when(value) {
  return value ? formatDateTime(value) : "—";
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="break-words text-sm text-slate-800">{children || "—"}</p>
    </div>
  );
}

export default function TrackingTab({ orderId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    ordersService
      .getTracking(orderId)
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load tracking"))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;

  const s = data?.smartlane;
  if (!s) {
    return (
      <p className="text-sm text-slate-500">
        No Smartlane tracking for this order yet. It fills in once Smartlane reports on it.
      </p>
    );
  }

  const history = s.tracking_history || [];
  const actions = s.advice_actions || [];
  const settled = s.courier_settlement === "Settled";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Account">
          {s.account}
          {data.dispatch_hub ? " (Dispatch Hub)" : ""}
        </Field>
        <Field label="Carrier">{CARRIER_LABELS[s.carrier] || readable(s.carrier)}</Field>
        <Field label="CN">{s.consignment_number}</Field>
        <Field label="Smartlane Stage">{readable(s.state)}</Field>
        <Field label="Carrier Status">{s.courier_status}</Field>
        <Field label="Settlement">
          {s.courier_settlement ? (
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${
                settled ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {s.courier_settlement}
            </span>
          ) : null}
        </Field>
        <Field label="Return Reason">{s.return_reason}</Field>
        <Field label="Order Label">{s.order_label}</Field>
        <Field label="Warehouse">
          {s.warehouse_name ? `${s.warehouse_name} (${s.warehouse_code})` : s.warehouse_code}
        </Field>
        <Field label="Batch ID">{s.batch_id}</Field>
        <Field label="Consignment ID">{s.consignment_id}</Field>
        <Field label="Store ID">{s.store_id}</Field>
      </div>

      {s.advice_reason || actions.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">Shipper advice requested</p>
          {s.advice_reason ? <p>{s.advice_reason}</p> : null}
          <p className="mt-0.5 text-xs text-amber-700">
            {actions.length ? `Options: ${actions.join(", ")} · ` : ""}
            Reply by {s.advice_expiry || "—"} · Received {when(s.advice_received_at)}
          </p>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-xs font-medium uppercase text-slate-500">Smartlane Stages</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
          {STAGES.map(([key, label]) => (
            <li key={key} className={s[key] ? "text-slate-800" : "text-slate-400"}>
              <p className="text-xs font-medium">{label}</p>
              <p className="text-xs">{when(s[key])}</p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase text-slate-500">Carrier Tracking</p>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No carrier scans yet.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((step, index) => (
              <li
                key={`${step.date}-${index}`}
                className="flex justify-between gap-3 rounded-md border border-surface-border bg-white px-3 py-1.5 text-sm"
              >
                <span className="text-slate-800">{step.status || "—"}</span>
                <span className="shrink-0 text-xs text-slate-400">{step.date}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {s.qrcode_url ? (
          <a href={s.qrcode_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
            QR code
          </a>
        ) : null}
        {s.barcode_url ? (
          <a href={s.barcode_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
            Barcode
          </a>
        ) : null}
        <span>Last synced {when(s.last_synced_at)}</span>
      </div>
    </div>
  );
}
