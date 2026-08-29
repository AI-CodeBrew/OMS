"use client";

import { useRef, useState } from "react";
import Button from "../shared/Button";
import Modal from "../shared/Modal";
import ordersService from "../../services/ordersService";

const COLUMNS = [
  "Web OrderID",
  "Order Date",
  "Cod Amount",
  "Courier",
  "CN",
  "Tags",
  "Status",
  "Invoice No",
  "Payment Status",
  "Delivery Charges",
];

const OPTIONAL_COLUMNS = ["Phone", "Product Name"];

const UNMATCHED_CSV_COLUMNS = [
  ["order_number", "Order Number"],
  ["order_date", "Order Date"],
  ["courier", "Courier"],
  ["cn", "CN"],
  ["invoice_number", "Invoice No"],
  ["payment_status", "Payment Status"],
  ["delivery_charges", "Delivery Charges"],
  ["tags", "Tags"],
  ["phone", "Phone"],
  ["product_name", "Product Name"],
];

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadUnmatchedCsv(rows) {
  const header = UNMATCHED_CSV_COLUMNS.map(([, label]) => csvCell(label)).join(",");
  const lines = rows.map((row) =>
    UNMATCHED_CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(",")
  );
  const blob = new Blob([[header, ...lines].join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "unmatched_orders.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function Stat({ label, value, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
  };
  return (
    <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

export default function ImportOrdersModal({ open, onClose, onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overwriteFinal, setOverwriteFinal] = useState(false);
  const [applied, setApplied] = useState(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setError("");
    setApplied(null);
    setOverwriteFinal(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    reset();
    onClose?.();
  }

  async function runPreview(nextFile, nextOverwrite = overwriteFinal) {
    setBusy(true);
    setError("");
    setApplied(null);
    try {
      const result = await ordersService.importCsv(nextFile, {
        apply: false,
        overwriteFinal: nextOverwrite,
      });
      setPreview(result);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function onPick(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    runPreview(picked);
  }

  function onToggleOverwrite(event) {
    const next = event.target.checked;
    setOverwriteFinal(next);
    // The protected-row count changes with this flag, so re-preview to keep
    // the numbers on screen honest.
    if (file) runPreview(file, next);
  }

  async function onApply() {
    setBusy(true);
    setError("");
    try {
      const result = await ordersService.importCsv(file, { apply: true, overwriteFinal });
      setApplied(result);
      setPreview(result);
      onImported?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import courier sheet"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {applied ? "Done" : "Cancel"}
          </Button>
          {!applied ? (
            <Button
              onClick={onApply}
              disabled={busy || !preview || preview.to_update === 0}
            >
              {busy
                ? "Working…"
                : preview
                  ? `Update ${preview.to_update} order${preview.to_update === 1 ? "" : "s"}`
                  : "Update orders"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Matches rows to existing orders by order number and fills in what the courier knows:
          delivery status, tag, CN / tracking number, courier, delivery charges and invoice number.
          It never creates orders. If a row&apos;s order number isn&apos;t found and the sheet has a
          phone column, it falls back to matching by phone - narrowed by product name or order
          date when one phone number covers more than one order.
        </p>

        <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Expected columns
          </div>
          <div className="mt-1 text-xs text-slate-600">{COLUMNS.join(" · ")}</div>
          <div className="mt-1 text-[11px] text-slate-400">
            Optional fallback columns: {OPTIONAL_COLUMNS.join(" · ")}
          </div>
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPick}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-900"
          />
          {file ? (
            <div className="mt-1 text-xs text-slate-500">{file.name}</div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {busy && !preview ? <div className="text-sm text-slate-500">Reading file…</div> : null}

        {preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Rows" value={preview.total_rows} />
              <Stat label="Matched" value={preview.matched} />
              <Stat label="To update" value={preview.to_update} tone="green" />
              <Stat label="Unchanged" value={preview.unchanged} />
              <Stat
                label="Not found"
                value={preview.unmatched}
                tone={preview.unmatched ? "amber" : "slate"}
              />
            </div>

            {preview.matched_by_phone > 0 ? (
              <div className="text-xs text-slate-500">
                Includes {preview.matched_by_phone} order
                {preview.matched_by_phone === 1 ? "" : "s"} matched by phone number (order id not
                found).
              </div>
            ) : null}

            {applied ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Imported. {applied.to_update} order
                {applied.to_update === 1 ? " was" : "s were"} updated.
              </div>
            ) : null}

            {preview.protected > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <div>
                  {preview.protected} order{preview.protected === 1 ? " is" : "s are"} already in a
                  final state (delivered / returned / cancelled) and would be changed by this sheet.
                  They are skipped.
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={overwriteFinal}
                    onChange={onToggleOverwrite}
                    disabled={busy}
                  />
                  Overwrite them anyway
                </label>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {preview.protected_samples.map((p) => (
                    <li key={p.order_number}>
                      {p.order_number}: {p.current} → {p.incoming}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview.errors?.length ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {preview.errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            ) : null}

            {preview.unmatched_samples?.length ? (
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Order numbers not found
                  </div>
                  {preview.unmatched_rows?.length ? (
                    <button
                      type="button"
                      onClick={() => downloadUnmatchedCsv(preview.unmatched_rows)}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      Download CSV
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {preview.unmatched_samples.join(", ")}
                  {preview.unmatched > preview.unmatched_samples.length
                    ? ` … and ${preview.unmatched - preview.unmatched_samples.length} more`
                    : ""}
                </div>
              </div>
            ) : null}

            {preview.samples?.length ? (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {applied ? "Changes applied (sample)" : "Preview of changes"}
                </div>
                <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-surface-border">
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {preview.samples.map((s) => (
                        <tr key={s.order_number} className="border-b border-surface-border last:border-0">
                          <td className="px-2 py-1.5 align-top font-medium text-slate-900">
                            {s.order_number}
                            {s.matched_via === "phone" ? (
                              <span className="ml-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-normal text-brand-700">
                                by phone
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {Object.entries(s.changes).map(([field, value]) => (
                              <div key={field}>
                                <span className="text-slate-400">{field}:</span> {value}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
