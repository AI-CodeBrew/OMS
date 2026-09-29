"use client";

import { useEffect, useState } from "react";
import Button from "../../../../../components/shared/Button";
import Modal from "../../../../../components/shared/Modal";
import barqraftarService from "../_lib/barqraftarService";

// BarqRaftar's own numeric status ids, from their Postman collection's
// description - kept in sync with backend/integrations/barqraftar/
// services.py's status map.
const STATUS_LABELS = {
  1: "Pending",
  2: "Awaiting Pickup",
  3: "Picked Up",
  4: "Dispatched",
  5: "Returned by Consignee",
  6: "Re-attempt Requested",
  7: "Hold Requested",
  8: "Return Requested",
  9: "Delivered",
  10: "Return in Transit",
  11: "Return in Progress",
  12: "Return Confirmation",
  13: "Return RFC Origin",
  14: "Re-attempt Approval",
  30: "RFC Origin",
  31: "In Transit",
  32: "Received at FC",
  98: "Returned to Shipper",
  99: "Cancelled",
};

const PAGE_SIZE = 20;

function todayMinus(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// GET /orders reports status as the numeric id ("1") but GET /order reports
// the slug ("pending") - confirmed live - so both are mapped to the id.
const STATUS_SLUGS = {
  pending: 1,
  awaiting_pickup: 2,
  picked_up: 3,
  dispatched: 4,
  return_by_consignee: 5,
  re_attempt_requested: 6,
  hold_requested: 7,
  return_requested: 8,
  delivered: 9,
  return_transit: 10,
  return_in_progress: 11,
  return_confirmation: 12,
  return_rfc_origin: 13,
  re_attempt_approval: 14,
  rfc_origin: 30,
  in_transit: 31,
  received_at_fc: 32,
  returned_to_shipper: 98,
  cancelled: 99,
};

function statusCodeOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return STATUS_SLUGS[String(value).toLowerCase()] ?? null;
}

// Real BarqRaftar order shape (confirmed live): tracking number is
// `number`, our own order number is `customer_reference`, destination is
// `to_city.name`.
function rowFields(row) {
  return {
    trackingNumber: row.number || row.tracking_number || "",
    referenceId: row.customer_reference || row.reference_id || "",
    statusCode: statusCodeOf(row.status),
    customerName: row.customer_name || "",
    city: row.to_city?.name || "",
    codAmount: row.cod_amount ?? "",
    date: row.created_at ? new Date(row.created_at).toLocaleString() : "",
    logs: Array.isArray(row.status_logs) ? row.status_logs : [],
  };
}

function TrackModal({ trackingNumber, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [row, setRow] = useState(null);

  useEffect(() => {
    if (!trackingNumber) return;
    setLoading(true);
    setError("");
    barqraftarService
      .trackShipment({ trackingNumber })
      .then((data) => setRow(rowFields(data)))
      .catch((err) => setError(err.message || "Failed to load tracking"))
      .finally(() => setLoading(false));
  }, [trackingNumber]);

  return (
    <Modal open={Boolean(trackingNumber)} onClose={onClose} title={`Track ${trackingNumber || ""}`} width="max-w-lg">
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : row ? (
        <div className="space-y-3">
          <div className="text-sm">
            <span className="font-medium text-slate-900">
              {STATUS_LABELS[row.statusCode] || `Status ${row.statusCode ?? "unknown"}`}
            </span>
          </div>
          {row.logs.length > 0 ? (
            <ul className="space-y-2 border-l-2 border-surface-border pl-3">
              {row.logs.map((log, i) => {
                // Dispatched (4) log entries carry the rider under these
                // exact keys, per BarqRaftar's docs.
                const rider = log["Delivery Rider Name"];
                const riderContact = log["Rider Contact"];
                return (
                  <li key={log.id || i} className="text-xs">
                    <span className="font-medium text-slate-700">
                      {STATUS_LABELS[statusCodeOf(log.status)] || log.status_value || `Status ${log.status}`}
                    </span>
                    {log.created_at ? (
                      <span className="text-slate-400"> — {new Date(log.created_at).toLocaleString()}</span>
                    ) : null}
                    {rider ? (
                      <div className="text-slate-500">
                        Rider: {rider} {riderContact || ""}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No status history yet.</p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export default function ShipmentsTab({ onError }) {
  const [filters, setFilters] = useState({
    date_from: todayMinus(30),
    date_to: todayMinus(0),
    status: "",
    search: "",
  });
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [trackingTarget, setTrackingTarget] = useState(null);
  const [busyTracking, setBusyTracking] = useState(null);

  async function load() {
    setLoading(true);
    onError("");
    try {
      // `search` is tried as a tracking number, then as our order number,
      // by the backend (see barqraftar/views.py's BarqRaftarShipmentsView).
      const data = await barqraftarService.getShipments({
        date_from: filters.date_from,
        date_to: filters.date_to,
        status: filters.status,
        search: filters.search.trim() || undefined,
        page,
        limit: PAGE_SIZE,
      });
      const list = data.orders || [];
      setRows(list.map(rowFields));
      setTotal(Number(data.total) || list.length);
    } catch (err) {
      onError(err.message || "Failed to load shipments");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function onFilter(e) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function onPrintLabel(row) {
    setBusyTracking(row.trackingNumber);
    onError("");
    try {
      await barqraftarService.printLabelsByTracking([row.trackingNumber]);
    } catch (err) {
      onError(err.message || "Failed to print label");
    } finally {
      setBusyTracking(null);
    }
  }

  async function onAwaitingPickup(row) {
    setBusyTracking(row.trackingNumber);
    onError("");
    try {
      await barqraftarService.shipmentAction({ action: "awaiting_pickup", tracking_number: row.trackingNumber });
      await load();
    } catch (err) {
      onError(err.message || "Failed to update status");
    } finally {
      setBusyTracking(null);
    }
  }

  async function onCancel(row) {
    if (!window.confirm(`Cancel shipment ${row.trackingNumber}?`)) return;
    setBusyTracking(row.trackingNumber);
    onError("");
    try {
      await barqraftarService.shipmentAction({ action: "cancel", tracking_number: row.trackingNumber });
      await load();
    } catch (err) {
      onError(err.message || "Failed to cancel");
    } finally {
      setBusyTracking(null);
    }
  }

  async function onShipperAdvice(row, advice) {
    setBusyTracking(row.trackingNumber);
    onError("");
    try {
      await barqraftarService.shipmentAction({
        action: "shipper_advice",
        tracking_number: row.trackingNumber,
        shipper_advice: advice,
        re_attempt_reason: advice === "re_attempt" ? "same_address" : undefined,
      });
      await load();
    } catch (err) {
      onError(err.message || "Failed to send shipper advice");
    } finally {
      setBusyTracking(null);
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">Shipments</h3>

      <form onSubmit={onFilter} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          >
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block flex-1 min-w-[160px]">
          <span className="mb-1 block text-xs font-medium text-slate-600">Tracking / Order #</span>
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="w-full rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="text-sm text-slate-500">No shipments match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500">
                <th className="py-2">Tracking</th>
                <th className="py-2">Order</th>
                <th className="py-2">Customer</th>
                <th className="py-2">City</th>
                <th className="py-2">COD</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((row) => {
                const busy = busyTracking === row.trackingNumber;
                return (
                  <tr key={row.trackingNumber || row.referenceId}>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-brand-700 hover:underline"
                        onClick={() => setTrackingTarget(row.trackingNumber)}
                      >
                        {row.trackingNumber || "-"}
                      </button>
                    </td>
                    <td className="py-2">{row.referenceId}</td>
                    <td className="py-2">{row.customerName}</td>
                    <td className="py-2">{row.city}</td>
                    <td className="py-2">{row.codAmount}</td>
                    <td className="py-2">{STATUS_LABELS[row.statusCode] || row.statusCode || "-"}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-2 text-xs">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onPrintLabel(row)}
                          className="text-brand-700 hover:underline disabled:opacity-50"
                        >
                          Print
                        </button>
                        {row.statusCode === 1 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onAwaitingPickup(row)}
                            className="text-brand-700 hover:underline disabled:opacity-50"
                          >
                            Ready for pickup
                          </button>
                        ) : null}
                        {row.statusCode === 1 || row.statusCode === 2 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCancel(row)}
                            className="text-red-600 hover:underline disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        ) : null}
                        {row.statusCode === 5 ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onShipperAdvice(row, "re_attempt")}
                              className="text-brand-700 hover:underline disabled:opacity-50"
                            >
                              Re-attempt
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onShipperAdvice(row, "hold")}
                              className="text-brand-700 hover:underline disabled:opacity-50"
                            >
                              Hold
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => onShipperAdvice(row, "return")}
                              className="text-red-600 hover:underline disabled:opacity-50"
                            >
                              Return
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="text-xs text-slate-500">
          {total} shipment{total === 1 ? "" : "s"}
        </span>
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>

      <TrackModal trackingNumber={trackingTarget} onClose={() => setTrackingTarget(null)} />
    </div>
  );
}
