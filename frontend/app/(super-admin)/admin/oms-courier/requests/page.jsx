"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Button from "../../../../../components/shared/Button";
import Modal from "../../../../../components/shared/Modal";
import integrationsAdminService from "../../../../../services/integrationsAdminService";
import timeAgo from "../../../../../lib/timeAgo";
// The store's own request forms, reused as-is so a correction is cleaned
// and laid out exactly like the store's submit.
import PostExAddressForm from "../../../../(tenant)/integrations/oms-courier/_components/PostExAddressForm";
import BarqRaftarAddressForm from "../../../../(tenant)/integrations/oms-courier/_components/BarqRaftarAddressForm";

const EDIT_FORM_ID = "oms-courier-request-edit-form";
// Couriers whose request is their own address form; the rest (Smartlane)
// carry the generic three fields.
const ADDRESS_FORMS = { postex: PostExAddressForm, barq_raftar: BarqRaftarAddressForm };

const inputClass =
  "mt-1 w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function GenericForm({ formId, initial, onSubmit }) {
  const [form, setForm] = useState(initial);
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      {[
        ["store_name", "Store name", "text"],
        ["phone", "Phone number", "tel"],
      ].map(([field, label, type]) => (
        <label key={field} className="block text-sm font-medium text-slate-700">
          {label}
          <input
            type={type}
            value={form[field]}
            onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
            required
            className={inputClass}
          />
        </label>
      ))}
      <label className="block text-sm font-medium text-slate-700">
        Pickup address
        <textarea
          value={form.pickup_address}
          onChange={(e) => setForm((f) => ({ ...f, pickup_address: e.target.value }))}
          rows={3}
          maxLength={500}
          required
          className={inputClass}
        />
      </label>
    </form>
  );
}

// The super admin correcting a request. The store is notified of exactly
// what changed (backend oms_courier_service.edit_request).
function EditRequestModal({ request, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const AddressForm = ADDRESS_FORMS[request.courier];
  const movesAddress = Boolean(AddressForm) && request.status === "approved";

  async function save(values) {
    if (
      movesAddress &&
      !window.confirm(
        `Save? A changed address is added to FynkTech's ${request.courier_name} account as a new ` +
          "pickup address, and this store's bookings go out from it from now on."
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      onSaved(await integrationsAdminService.editOmsCourierRequest(request.id, values));
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title={`Edit ${request.courier_name} request - ${request.organization_name}`}
      width={AddressForm ? "max-w-2xl" : "max-w-md"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={EDIT_FORM_ID} loading={saving}>
            Save and notify store
          </Button>
        </>
      }
    >
      <p className="text-xs text-slate-500">
        The store gets a notification listing what you changed.
        {movesAddress
          ? ` Already approved: a changed address becomes a new pickup address on FynkTech's ` +
            `${request.courier_name} account (${request.courier_name} can't edit one in place).`
          : ""}
      </p>
      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="mt-4">
        {AddressForm ? (
          <AddressForm
            formId={EDIT_FORM_ID}
            initial={request.details || {}}
            addressCode={request.courier_reference}
            pickupAddressId={request.courier_reference}
            onSubmit={save}
          />
        ) : (
          <GenericForm
            formId={EDIT_FORM_ID}
            initial={{
              store_name: request.store_name || "",
              phone: request.phone || "",
              pickup_address: request.pickup_address || "",
            }}
            onSubmit={save}
          />
        )}
      </div>
    </Modal>
  );
}

const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "", label: "All" },
];

const STATUS_PILL = {
  pending: { text: "Pending", className: "bg-amber-50 text-amber-700" },
  approved: { text: "Approved", className: "bg-green-100 text-green-700" },
  rejected: { text: "Rejected", className: "bg-red-50 text-red-700" },
};

const POSTEX_ADDRESS_TYPES = {
  return: "Return Address",
  pickup: "Pickup Address",
  pickup_return: "Pickup/Return Address",
};

function Detail({ label, children }) {
  if (!children) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-700">{children}</dd>
    </div>
  );
}

function RequestCard({ request, onAnswered }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editable = request.status !== "rejected";
  const pill = STATUS_PILL[request.status] || STATUS_PILL.pending;
  const smartlane = request.smartlane;
  const postex = request.courier === "postex" ? request.details || {} : null;
  const hasPostExForm = Boolean(postex && postex.address);
  const barq = request.courier === "barq_raftar" ? request.details || {} : null;
  const hasBarqForm = Boolean(barq && barq.address);
  // Couriers whose approval adds the store's address to FynkTech's account.
  const addsAddress = Boolean(postex || barq);
  const hasAddressForm = hasPostExForm || hasBarqForm;

  async function answer(kind) {
    const text = message.trim();
    if (kind === "reject" && !text) {
      setError("Write a message - the store sees why it was rejected.");
      return;
    }
    const what = `${request.courier_name} for ${request.organization_name}`;
    if (!window.confirm(kind === "approve" ? `Approve ${what}?` : `Reject ${what}?`)) return;
    setBusy(kind);
    setError("");
    try {
      const updated =
        kind === "approve"
          ? await integrationsAdminService.approveOmsCourierRequest(request.id, text)
          : await integrationsAdminService.rejectOmsCourierRequest(request.id, text);
      onAnswered(updated);
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setBusy("");
    }
  }

  return (
    <li className="rounded-xl border border-surface-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {request.organization_name}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {request.courier_name}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {request.requested_at ? (
              <span title={new Date(request.requested_at).toLocaleString()}>
                Requested {timeAgo(request.requested_at)}
              </span>
            ) : null}
            {!request.is_enabled && request.status === "approved" ? " · turned off by the store" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editable ? (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setSaved(false);
              }}
              className="rounded-md border border-surface-border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
          ) : null}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${pill.className}`}>
            {pill.text}
          </span>
        </div>
      </div>
      {saved ? (
        <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
          Saved - the store was notified of the changes.
        </p>
      ) : null}
      {editing ? (
        <EditRequestModal
          request={request}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            setSaved(true);
            onAnswered(updated);
          }}
        />
      ) : null}

      {hasPostExForm ? (
        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-700">PostEx address</p>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <Detail label="City">{postex.city}</Detail>
            <Detail label="Address type">
              {POSTEX_ADDRESS_TYPES[postex.address_type] || postex.address_type}
            </Detail>
            <Detail label="Address code">
              {request.courier_reference ? (
                <span className="font-mono">{request.courier_reference}</span>
              ) : (
                "Given by PostEx on approval"
              )}
            </Detail>
            <Detail label="Shipper name">{postex.shipper_name}</Detail>
            <Detail label="Shipper contact">{postex.shipper_contact}</Detail>
            <Detail label="Contact person">{postex.contact_person_name}</Detail>
            <Detail label="Contact#1">{postex.contact_1}</Detail>
            <Detail label="Contact#2">{postex.contact_2}</Detail>
          </dl>
          <dl className="mt-4">
            <Detail label="Address">{postex.address}</Detail>
          </dl>
        </div>
      ) : hasBarqForm ? (
        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-700">BarqRaftar pickup address</p>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <Detail label="Store name">{barq.name}</Detail>
            <Detail label="City">{barq.city_name}</Detail>
            <Detail label="Pickup address ID">
              {request.courier_reference ? (
                <span className="font-mono">{request.courier_reference}</span>
              ) : (
                "Given by BarqRaftar on approval"
              )}
            </Detail>
            <Detail label="Person of contact">{barq.person_of_contact}</Detail>
            <Detail label="Phone">{barq.phone_number}</Detail>
            <Detail label="Location">
              {barq.latitude && barq.longitude ? `${barq.latitude}, ${barq.longitude}` : ""}
            </Detail>
          </dl>
          <dl className="mt-4">
            <Detail label="Address">{barq.address}</Detail>
          </dl>
        </div>
      ) : (
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Detail label="Store name">{request.store_name}</Detail>
          <Detail label="Phone">{request.phone}</Detail>
          <Detail label="Pickup address">{request.pickup_address}</Detail>
        </dl>
      )}

      {smartlane ? (
        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-700">Business details</p>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <Detail label="Business">{smartlane.business_name}</Detail>
            <Detail label="Industry">{smartlane.industry}</Detail>
            <Detail label="Contact person">{smartlane.contact_name}</Detail>
            <Detail label="Email">{smartlane.email}</Detail>
            <Detail label="Mobile">{smartlane.phone}</Detail>
            <Detail label="City">
              {[smartlane.city, smartlane.state].filter(Boolean).join(", ")}
            </Detail>
          </dl>
          <Link
            href="/admin/oms-courier/smartlane-business"
            className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline"
          >
            Full business details in the Smartlane Business console →
          </Link>
        </div>
      ) : null}

      {!request.in_dispatch_hub ? (
        <p className="mt-4 text-xs text-amber-700">
          This store isn&apos;t in the Dispatch Hub yet - an approved courier does nothing until it
          is.{" "}
          <Link href="/admin/dispatch-hub" className="font-medium underline">
            Add it to the Hub
          </Link>
        </p>
      ) : null}

      {request.status === "pending" ? (
        <div className="mt-4 space-y-3 border-t border-surface-border pt-4">
          <label className="block text-sm font-medium text-slate-700">
            Message to the store
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Approved - we'll start dispatching your orders from Monday."
              className="mt-1 w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          {addsAddress ? (
            <p className="text-xs text-slate-500">
              {hasAddressForm
                ? `Approving adds this address to FynkTech's ${request.courier_name} account - every ` +
                  `${request.courier_name} order of this store is then picked up from it. If ` +
                  `${request.courier_name} refuses it, the request stays pending.`
                : `This request came before the ${request.courier_name} address form - reject it so ` +
                  "the store sends the form again."}
            </p>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="danger"
              onClick={() => answer("reject")}
              loading={busy === "reject"}
              disabled={Boolean(busy)}
            >
              Reject
            </Button>
            <Button onClick={() => answer("approve")} loading={busy === "approve"} disabled={Boolean(busy)}>
              Approve
            </Button>
          </div>
        </div>
      ) : request.review_note || request.reviewed_at ? (
        <div className="mt-4 border-t border-surface-border pt-4 text-sm">
          {request.review_note ? (
            <p className="text-slate-700">
              <span className="font-medium">Message:</span> {request.review_note}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-400">
            {request.status === "approved" ? "Approved" : "Rejected"}
            {request.reviewed_by_email ? ` by ${request.reviewed_by_email}` : ""}
            {request.reviewed_at ? ` · ${timeAgo(request.reviewed_at)}` : ""}
          </p>
        </div>
      ) : null}
    </li>
  );
}

export default function OmsCourierRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await integrationsAdminService.listOmsCourierRequests());
    } catch (err) {
      setError(err.message || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const out = { "": requests.length };
    for (const r of requests) out[r.status] = (out[r.status] || 0) + 1;
    return out;
  }, [requests]);

  const visible = filter ? requests.filter((r) => r.status === filter) : requests;

  function onAnswered(updated) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/admin/oms-courier" className="hover:text-slate-700">
          OMS Couriers
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-700">Requests</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          Stores asking FynkTech to ship their orders with a courier, from their OMS Courier page.
          Approve or reject with a message - the store sees it there.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? "bg-brand-800 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.label}
            {counts[f.key] ? ` (${counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {loading ? (
        <p className="px-1 py-10 text-sm text-slate-500">Loading requests…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-surface-border bg-white px-5 py-12 text-center text-sm text-slate-500">
          {filter === "pending" ? "No requests waiting for you." : "Nothing here."}
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((r) => (
            <RequestCard key={r.id} request={r} onAnswered={onAnswered} />
          ))}
        </ul>
      )}
    </div>
  );
}
