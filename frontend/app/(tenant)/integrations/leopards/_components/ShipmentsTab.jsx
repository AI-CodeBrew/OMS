"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../../../../../components/shared/Button";
import Modal from "../../../../../components/shared/Modal";
import leopardsService from "../_lib/leopardsService";

import { formatDateTime } from "../../../../../lib/formatDate";
const PAGE_SIZE = 25;
const MAX_DAYS = 92;

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

// The words Leopards uses before it has the parcel - the only time our own
// cancel can still ask Leopards to cancel it (see backend
// leopards/services.py's _STAGE_BY_TEXT "pending").
const CANCELLABLE = new Set([
  "booked",
  "pickup request not send",
  "pickup request not sent",
  "pickup request send",
  "pickup request sent",
]);

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : formatDateTime(d);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : value ?? "";
}

function TrackModal({ trackingNumber, onClose, onAdvice }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!trackingNumber) return;
    setLoading(true);
    setError("");
    setData(null);
    leopardsService
      .trackShipment(trackingNumber)
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load tracking"))
      .finally(() => setLoading(false));
  }, [trackingNumber]);

  const order = data?.order || {};
  // Leopards' own spelling of the history key is "Tracking Detail" and its
  // entries' status key "Staus" in the sample - both spellings are read.
  const history = Array.isArray(order["Tracking Detail"]) ? order["Tracking Detail"] : [];
  const payment = Array.isArray(data?.payment) ? data.payment[0] || {} : {};
  const advice = Array.isArray(data?.advice) ? data.advice : [];

  return (
    <Modal open={Boolean(trackingNumber)} onClose={onClose} title={`Track ${trackingNumber || ""}`} width="max-w-xl">
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-slate-500">Status</div>
              <div className="font-medium text-slate-900">{order.booked_packet_status || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Order ref</div>
              <div className="text-slate-800">{order.booked_packet_order_id || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Customer</div>
              <div className="text-slate-800">
                {order.consignment_name_eng} {order.consignment_phone ? `· ${order.consignment_phone}` : ""}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">COD</div>
              <div className="text-slate-800">
                Rs {money(order.booked_packet_collect_amount)}{" "}
                {payment.status ? <span className="text-slate-500">({payment.status})</span> : null}
              </div>
            </div>
          </div>

          {order.status_remarks ? (
            <div>
              <div className="text-xs text-slate-500">Remarks</div>
              <div className="text-slate-800">{order.status_remarks}</div>
            </div>
          ) : null}

          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Journey</div>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No status history yet.</p>
            ) : (
              <ul className="space-y-1.5 border-l-2 border-surface-border pl-3">
                {[...history].reverse().map((h, i) => (
                  <li key={`${h["Activity Date"] || i}-${i}`} className="text-xs">
                    <span className="font-medium text-slate-700">{h.Status || h.Staus}</span>
                    {h["Activity Date"] ? <span className="text-slate-400"> — {h["Activity Date"]}</span> : null}
                    {h.Reason ? <span className="text-slate-500"> ({h.Reason})</span> : null}
                    {h["Reciever Name"] ? <span className="text-slate-500"> · {h["Reciever Name"]}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {advice.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">Waiting on you (shipper advice)</div>
              <ul className="space-y-1 text-xs">
                {advice.map((a, i) => (
                  <li key={a.id || i}>
                    <span className="text-slate-700">{a.reason || a.status}</span>
                    <span className="text-slate-400"> — {a.shipper_advice_status || "no answer yet"}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-3 text-xs">
                <button type="button" className="text-brand-700 hover:underline" onClick={() => onAdvice("RA")}>
                  Ask for re-attempt
                </button>
                <button type="button" className="text-red-600 hover:underline" onClick={() => onAdvice("RT")}>
                  Ask for return
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function AdviceModal({ target, onClose, onSubmit, submitting }) {
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    setRemarks("");
  }, [target]);

  if (!target) return null;
  const isReturn = target.status === "RT";
  return (
    <Modal
      open
      onClose={onClose}
      title={`${isReturn ? "Return" : "Re-attempt"} ${target.trackingNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isReturn ? "danger" : "primary"}
            loading={submitting}
            disabled={!remarks.trim()}
            onClick={() => onSubmit(remarks.trim())}
          >
            {isReturn ? "Ask Leopards to return it" : "Ask Leopards to re-attempt"}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Remarks for Leopards</span>
        <textarea
          rows={3}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={isReturn ? "e.g. Customer refused, please return" : "e.g. Customer confirmed, deliver tomorrow"}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
      </label>
    </Modal>
  );
}

export default function ShipmentsTab({ onError, onNotice }) {
  const [filters, setFilters] = useState({ dateFrom: isoDaysAgo(29), dateTo: isoDaysAgo(0), search: "" });
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [trackingTarget, setTrackingTarget] = useState(null);
  const [adviceTarget, setAdviceTarget] = useState(null);
  const [busyTracking, setBusyTracking] = useState(null);

  async function load(current = filters) {
    setLoading(true);
    onError("");
    try {
      const data = await leopardsService.getShipments({
        dateFrom: current.dateFrom,
        dateTo: current.dateTo,
        search: current.search.trim() || undefined,
      });
      setRows(data.orders || []);
      setPage(1);
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
  }, []);

  function onFilter(e) {
    e.preventDefault();
    const days = (new Date(filters.dateTo) - new Date(filters.dateFrom)) / 86400000 + 1;
    if (!filters.search.trim() && days > MAX_DAYS) {
      onError(`Pick a range of ${MAX_DAYS} days or less.`);
      return;
    }
    load(filters);
  }

  const pageRows = useMemo(
    () => (rows || []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  );
  const total = rows?.length || 0;

  async function onPrintAirwayBill(row) {
    setBusyTracking(row.tracking_number);
    onError("");
    try {
      await leopardsService.printAirwayBills([row.oms_order_id]);
    } catch (err) {
      onError(err.message || "Failed to print airway bill");
    } finally {
      setBusyTracking(null);
    }
  }

  async function onCancel(row) {
    if (!window.confirm(`Cancel Leopards shipment ${row.tracking_number} and its OMS order ${row.oms_order_number}?`)) {
      return;
    }
    setBusyTracking(row.tracking_number);
    onError("");
    try {
      await leopardsService.shipmentAction({ action: "cancel", tracking_number: row.tracking_number });
      onNotice?.(`Shipment ${row.tracking_number} cancelled.`);
      await load();
    } catch (err) {
      onError(err.message || "Failed to cancel");
    } finally {
      setBusyTracking(null);
    }
  }

  async function onSubmitAdvice(remarks) {
    const target = adviceTarget;
    setBusyTracking(target.trackingNumber);
    onError("");
    try {
      await leopardsService.shipmentAction({
        action: "shipper_advice",
        tracking_number: target.trackingNumber,
        status: target.status,
        remarks,
      });
      setAdviceTarget(null);
      onNotice?.(`Sent to Leopards for ${target.trackingNumber}.`);
    } catch (err) {
      onError(err.message || "Failed to send advice to Leopards");
    } finally {
      setBusyTracking(null);
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-white p-5">
      <h3 className="mb-1 text-sm font-semibold text-slate-900">Shipments booked with Leopards</h3>
      <p className="mb-4 text-xs text-slate-500">Parcels booked from OMS, by booking date.</p>

      <form onSubmit={onFilter} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block min-w-[160px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">CN / Order #</span>
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
      ) : total === 0 ? (
        <p className="text-sm text-slate-500">No Leopards shipments match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500">
                <th className="py-2">CN</th>
                <th className="py-2">Order</th>
                <th className="py-2">Customer</th>
                <th className="py-2">City</th>
                <th className="py-2">COD</th>
                <th className="py-2">Status</th>
                <th className="py-2">Booked</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {pageRows.map((row) => {
                const busy = busyTracking === row.tracking_number;
                const status = norm(row.status_label);
                return (
                  <tr key={row.id} className={row.is_active ? "" : "text-slate-400"}>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-brand-700 hover:underline"
                        onClick={() => setTrackingTarget(row.tracking_number)}
                      >
                        {row.tracking_number}
                      </button>
                    </td>
                    <td className="py-2">{row.oms_order_number}</td>
                    <td className="max-w-[160px] truncate py-2" title={row.customer_name}>
                      {row.customer_name}
                    </td>
                    <td className="py-2">{row.city}</td>
                    <td className="py-2">{money(row.cod_amount)}</td>
                    <td className="py-2">{row.is_active ? row.status_label || "-" : "Cancelled"}</td>
                    <td className="whitespace-nowrap py-2 text-xs text-slate-500">{formatDate(row.booked_at)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-2 text-xs">
                        {row.is_active ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onPrintAirwayBill(row)}
                            className="text-brand-700 hover:underline disabled:opacity-50"
                          >
                            Airway bill
                          </button>
                        ) : null}
                        {row.is_active && CANCELLABLE.has(status) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCancel(row)}
                            className="text-red-600 hover:underline disabled:opacity-50"
                          >
                            Cancel
                          </button>
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

      <TrackModal
        trackingNumber={trackingTarget}
        onClose={() => setTrackingTarget(null)}
        onAdvice={(status) => {
          setAdviceTarget({ trackingNumber: trackingTarget, status });
          setTrackingTarget(null);
        }}
      />
      <AdviceModal
        target={adviceTarget}
        onClose={() => setAdviceTarget(null)}
        onSubmit={onSubmitAdvice}
        submitting={Boolean(adviceTarget) && busyTracking === adviceTarget?.trackingNumber}
      />
    </div>
  );
}
