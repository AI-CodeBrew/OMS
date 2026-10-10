"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Button from "../../../../../components/shared/Button";
import integrationsAdminService from "../../../../../services/integrationsAdminService";
import timeAgo from "../../../../../lib/timeAgo";

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
  const pill = STATUS_PILL[request.status] || STATUS_PILL.pending;
  const smartlane = request.smartlane;

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
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${pill.className}`}>
          {pill.text}
        </span>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <Detail label="Store name">{request.store_name}</Detail>
        <Detail label="Phone">{request.phone}</Detail>
        <Detail label="Pickup address">{request.pickup_address}</Detail>
      </dl>

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
