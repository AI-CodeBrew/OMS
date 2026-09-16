"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "../shared/Modal";
import Button, { Spinner } from "../shared/Button";
import Checkbox from "../shared/Checkbox";
import ordersService from "../../services/ordersService";

function CheckIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 10.5 8 14.5 16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StatusMark({ status }) {
  if (status === "generating") return <Spinner className="text-slate-500" />;
  if (status === "done") return <CheckIcon className="h-4 w-4 text-green-600" />;
  if (status === "error") return <ErrorIcon className="h-4 w-4 text-red-600" />;
  return null;
}

/**
 * Shown instead of immediately downloading when 2+ Ready to Print orders are
 * selected for "Print Airway Bill" - lets the operator either keep today's
 * behavior (everyone in one combined PDF) or split it into one PDF per
 * product. Every generated PDF still goes through the exact same
 * ordersService.printSmartlaneAirwayBill()/Smartlane endpoint as before -
 * this only changes which order ids get sent, and how many times.
 */
const MODES = [
  { value: "all", label: "All (Mixed)" },
  { value: "product", label: "By Product" },
  { value: "orderid", label: "By Order ID" },
];

// "#10858" or "10858" both match - whatever the operator actually has on
// hand (order number as shown in the UI, with or without the leading #).
function normalizeOrderNumber(value) {
  return String(value || "").trim().replace(/^#/, "").toLowerCase();
}

export default function AirwayBillFilterModal({ orders, onClose }) {
  const [mode, setMode] = useState("all");
  const [selectedProducts, setSelectedProducts] = useState(() => new Set());
  const [allStatus, setAllStatus] = useState("idle");
  const [rowStatus, setRowStatus] = useState({});
  const [orderIdInput, setOrderIdInput] = useState("");
  const [orderIdStatus, setOrderIdStatus] = useState("idle");
  const [orderIdNotFound, setOrderIdNotFound] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode("all");
    setSelectedProducts(new Set());
    setAllStatus("idle");
    setRowStatus({});
    setOrderIdInput("");
    setOrderIdStatus("idle");
    setOrderIdNotFound([]);
    setError("");
  }, [orders]);

  const productEntries = useMemo(() => {
    const counts = new Map();
    for (const order of orders || []) {
      const names = new Set((order.items || []).map((i) => i.product_name).filter(Boolean));
      for (const name of names) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  if (!orders || orders.length === 0) return null;

  const busy =
    allStatus === "generating" ||
    orderIdStatus === "generating" ||
    Object.values(rowStatus).includes("generating");

  function toggleProduct(name) {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleGenerateAll() {
    setError("");
    setAllStatus("generating");
    try {
      await ordersService.printSmartlaneAirwayBill(orders.map((o) => o.id));
      setAllStatus("done");
    } catch (err) {
      setAllStatus("error");
      setError(err.message || "Print failed");
    }
  }

  async function handleGenerateProducts() {
    setError("");
    for (const name of selectedProducts) {
      setRowStatus((prev) => ({ ...prev, [name]: "generating" }));
      try {
        const ids = orders
          .filter((o) => (o.items || []).some((i) => i.product_name === name))
          .map((o) => o.id);
        await ordersService.printSmartlaneAirwayBill(ids, name);
        setRowStatus((prev) => ({ ...prev, [name]: "done" }));
      } catch (err) {
        setRowStatus((prev) => ({ ...prev, [name]: "error" }));
        setError(err.message || `Failed to print "${name}"`);
      }
    }
  }

  async function handleGenerateByOrderId() {
    setError("");
    setOrderIdNotFound([]);
    const tokens = orderIdInput
      .split(",")
      .map((t) => normalizeOrderNumber(t))
      .filter(Boolean);
    if (tokens.length === 0) {
      setError("Enter at least one order number.");
      return;
    }
    const byNumber = new Map(orders.map((o) => [normalizeOrderNumber(o.order_number), o]));
    const matched = [];
    const notFound = [];
    for (const token of tokens) {
      const order = byNumber.get(token);
      if (order) matched.push(order);
      else notFound.push(token);
    }
    setOrderIdNotFound(notFound);
    if (matched.length === 0) {
      setError("None of those order numbers are in the current selection.");
      return;
    }
    setOrderIdStatus("generating");
    try {
      await ordersService.printSmartlaneAirwayBill(matched.map((o) => o.id), "selected");
      setOrderIdStatus("done");
    } catch (err) {
      setOrderIdStatus("error");
      setError(err.message || "Print failed");
    }
  }

  return (
    <Modal open title="Print Airway Bill" onClose={onClose} width="max-w-lg">
      <p className="mb-3 text-sm text-slate-500">
        {orders.length} orders selected. Print them all together, or split by product.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            disabled={busy}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === m.value
                ? "border-brand-700 bg-brand-800 text-white"
                : "border-surface-border bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {mode === "all" ? (
        <div className="flex items-center justify-between rounded-md border border-surface-border p-3">
          <span className="text-sm text-slate-700">One combined PDF for all {orders.length} orders</span>
          <div className="flex items-center gap-2">
            <StatusMark status={allStatus} />
            <Button onClick={handleGenerateAll} loading={allStatus === "generating"} disabled={busy}>
              Generate
            </Button>
          </div>
        </div>
      ) : mode === "product" ? (
        <>
          <div className="max-h-64 overflow-y-auto rounded-md border border-surface-border">
            {productEntries.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">No products found on these orders.</p>
            ) : (
              productEntries.map(({ name, count }) => (
                <label
                  key={name}
                  className="flex items-center justify-between gap-3 border-b border-surface-border px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedProducts.has(name)}
                      onChange={() => toggleProduct(name)}
                      disabled={busy}
                    />
                    <span className="text-slate-800">{name}</span>
                    <span className="text-xs text-slate-400">({count} order{count === 1 ? "" : "s"})</span>
                  </span>
                  <StatusMark status={rowStatus[name]} />
                </label>
              ))
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={handleGenerateProducts}
              loading={busy}
              disabled={selectedProducts.size === 0 || busy}
            >
              Generate Selected ({selectedProducts.size})
            </Button>
          </div>
        </>
      ) : (
        <div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              Order numbers (comma-separated)
            </span>
            <input
              value={orderIdInput}
              onChange={(e) => setOrderIdInput(e.target.value)}
              disabled={busy}
              placeholder="e.g. 10858, 10860, #10893"
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
            />
          </label>
          <p className="mt-1 text-xs text-slate-400">
            Only matched against the {orders.length} orders currently selected on the Orders page.
          </p>
          {orderIdNotFound.length > 0 ? (
            <p className="mt-2 text-xs text-amber-600">
              Not in the current selection: {orderIdNotFound.join(", ")}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <StatusMark status={orderIdStatus} />
            <Button
              onClick={handleGenerateByOrderId}
              loading={orderIdStatus === "generating"}
              disabled={busy || orderIdInput.trim().length === 0}
            >
              Generate
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
