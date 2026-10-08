"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../../../../../components/shared/Button";
import Modal from "../../../../../components/shared/Modal";
import postexService from "../_lib/postexService";

// PostEx's orderStatusId filter values (from their guide, each one checked
// against the account's real orders). The labels in brackets are how the
// same status reads in PostEx's order list.
const STATUS_FILTERS = [
  { id: 1, label: "Unbooked" },
  { id: 2, label: "Booked" },
  { id: 15, label: "Picked By PostEx" },
  { id: 3, label: "At PostEx Warehouse (In Stock)" },
  { id: 18, label: "En-Route (Transferred)" },
  { id: 4, label: "Out For Delivery (Delivery En-Route)" },
  { id: 17, label: "Attempted" },
  { id: 9, label: "Delivery Under Review (Under Verification)" },
  { id: 5, label: "Delivered" },
  { id: 16, label: "Out For Return (Return In-Transit)" },
  { id: 6, label: "Returned" },
  { id: 7, label: "Un-Assigned By Me" },
  { id: 8, label: "Expired" },
];

const PAGE_SIZE = 25;
const MAX_DAYS = 31;

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

// Both of PostEx's vocabularies (list vs track) - see
// backend/integrations/postex/services.py's _STAGE_BY_STATUS.
const CANCELLABLE = new Set(["unbooked", "booked"]);
const NEEDS_ADVICE = new Set(["attempted", "delivery under review", "under verification"]);

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : value ?? "";
}

function TrackModal({ trackingNumber, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!trackingNumber) return;
    setLoading(true);
    setError("");
    setData(null);
    postexService
      .trackShipment(trackingNumber)
      .then(setData)
      .catch((err) => setError(err.message || "Failed to load tracking"))
      .finally(() => setLoading(false));
  }, [trackingNumber]);

  const order = data?.order || {};
  const history = Array.isArray(order.transactionStatusHistory) ? order.transactionStatusHistory : [];
  const payment = data?.payment || {};
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
              <div className="font-medium text-slate-900">{order.transactionStatus || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Order ref</div>
              <div className="text-slate-800">{order.orderRefNumber || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Customer</div>
              <div className="text-slate-800">
                {order.customerName} {order.customerPhone ? `· ${order.customerPhone}` : ""}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">COD</div>
              <div className="text-slate-800">
                Rs {money(order.invoicePayment)}{" "}
                <span className={payment.settle ? "text-green-700" : "text-slate-500"}>
                  ({payment.settle ? `settled${payment.settlementDate ? ` ${payment.settlementDate}` : ""}` : "not settled yet"})
                </span>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Journey</div>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No status history yet.</p>
            ) : (
              <ul className="space-y-1.5 border-l-2 border-surface-border pl-3">
                {[...history].reverse().map((h, i) => (
                  <li key={`${h.transactionStatusMessageCode}-${h.updatedAt || i}`} className="text-xs">
                    <span className="font-medium text-slate-700">{h.transactionStatusMessage}</span>
                    {h.updatedAt ? <span className="text-slate-400"> — {formatDate(h.updatedAt)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {advice.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">Remarks</div>
              <ul className="space-y-1 text-xs">
                {advice.map((a, i) => (
                  <li key={i}>
                    <span className="text-slate-700">{a.remarks}</span>
                    <span className="text-slate-400">
                      {" "}
                      — {a.username} {a.remarksDate}
                    </span>
                  </li>
                ))}
              </ul>
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
  const isReturn = target.statusId === 1;
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
            {isReturn ? "Ask PostEx to return it" : "Ask PostEx to re-attempt"}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Remarks for PostEx</span>
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
  const [filters, setFilters] = useState({
    dateFrom: isoDaysAgo(6),
    dateTo: isoDaysAgo(0),
    statusId: "",
    search: "",
  });
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
      const data = await postexService.getShipments({
        dateFrom: current.dateFrom,
        dateTo: current.dateTo,
        statusId: current.statusId,
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
      onError(`Pick a range of ${MAX_DAYS} days or less - PostEx is slow over longer ranges.`);
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
    setBusyTracking(row.trackingNumber);
    onError("");
    try {
      await postexService.printAirwayBillsByTracking([row.trackingNumber]);
    } catch (err) {
      onError(err.message || "Failed to print airway bill");
    } finally {
      setBusyTracking(null);
    }
  }

  async function onCancel(row) {
    if (!window.confirm(`Cancel PostEx shipment ${row.trackingNumber} and its OMS order ${row.oms_order_number}?`)) {
      return;
    }
    setBusyTracking(row.trackingNumber);
    onError("");
    try {
      await postexService.shipmentAction({ action: "cancel", tracking_number: row.trackingNumber });
      onNotice?.(`Shipment ${row.trackingNumber} cancelled.`);
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
      await postexService.shipmentAction({
        action: "shipper_advice",
        tracking_number: target.trackingNumber,
        status_id: target.statusId,
        remarks,
      });
      setAdviceTarget(null);
      onNotice?.(`Sent to PostEx for ${target.trackingNumber}.`);
    } catch (err) {
      onError(err.message || "Failed to send advice to PostEx");
    } finally {
      setBusyTracking(null);
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">Shipments on PostEx</h3>

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
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
          <select
            value={filters.statusId}
            onChange={(e) => setFilters((f) => ({ ...f, statusId: e.target.value }))}
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          >
            <option value="">All</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-[160px] flex-1">
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
      ) : total === 0 ? (
        <p className="text-sm text-slate-500">No PostEx shipments match these filters.</p>
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
                <th className="py-2">Booked</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {pageRows.map((row) => {
                const busy = busyTracking === row.trackingNumber;
                const status = norm(row.transactionStatus);
                return (
                  <tr key={row.trackingNumber}>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-brand-700 hover:underline"
                        onClick={() => setTrackingTarget(row.trackingNumber)}
                      >
                        {row.trackingNumber}
                      </button>
                    </td>
                    <td className="py-2">{row.oms_order_number || row.orderRefNumber}</td>
                    <td className="max-w-[160px] truncate py-2" title={row.customerName}>
                      {row.customerName}
                    </td>
                    <td className="py-2">{row.cityName}</td>
                    <td className="py-2">{money(row.invoicePayment)}</td>
                    <td className="py-2">{row.transactionStatus || "-"}</td>
                    <td className="whitespace-nowrap py-2 text-xs text-slate-500">{formatDate(row.transactionDate)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-2 text-xs">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onPrintAirwayBill(row)}
                          className="text-brand-700 hover:underline disabled:opacity-50"
                        >
                          Airway bill
                        </button>
                        {row.oms_order_id && CANCELLABLE.has(status) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCancel(row)}
                            className="text-red-600 hover:underline disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        ) : null}
                        {NEEDS_ADVICE.has(status) ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setAdviceTarget({ trackingNumber: row.trackingNumber, statusId: 2 })}
                              className="text-brand-700 hover:underline disabled:opacity-50"
                            >
                              Re-attempt
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setAdviceTarget({ trackingNumber: row.trackingNumber, statusId: 1 })}
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
      <AdviceModal
        target={adviceTarget}
        onClose={() => setAdviceTarget(null)}
        onSubmit={onSubmitAdvice}
        submitting={Boolean(adviceTarget) && busyTracking === adviceTarget?.trackingNumber}
      />
    </div>
  );
}
