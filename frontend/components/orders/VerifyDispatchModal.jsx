"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";

export default function VerifyDispatchModal({ open, onClose, onDispatched }) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setResults([]);
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  async function onSubmit(e) {
    e.preventDefault();
    const orderNumber = value.trim();
    if (!orderNumber || submitting) return;
    setSubmitting(true);
    try {
      const result = await ordersService.scanDispatch({ orderNumber });
      setResults((r) => [{ ...result, order_number: result.order_number || orderNumber }, ...r]);
      if (result.success) onDispatched?.();
    } catch (err) {
      setResults((r) => [{ success: false, order_number: orderNumber, reason: err.message }, ...r]);
    } finally {
      setValue("");
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Verify and Dispatch">
      <p className="mb-3 text-sm text-slate-500">
        Scan or type each order number, then press Enter. Only orders Awaiting Dispatched can be
        dispatched.
      </p>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Order number"
          className="flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Button type="submit" disabled={submitting}>
          Confirm
        </Button>
      </form>

      <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto text-sm">
        {results.map((r, i) => (
          <li
            key={`${r.order_number}-${i}`}
            className={`flex items-center justify-between rounded-md px-3 py-2 ${
              r.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            <span className="font-medium">{r.order_number}</span>
            <span className="text-xs">{r.success ? "Dispatched" : r.reason}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
