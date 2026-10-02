"use client";

import { useRef, useState } from "react";
import Button from "../shared/Button";
import Modal from "../shared/Modal";
import ordersService from "../../services/ordersService";
import useLoadingStore from "../../store/loadingStore";

const COLUMNS = [
  "Order No",
  "Order Date",
  "Customer Name",
  "Phone",
  "Address",
  "City",
  "Product",
  "SKU",
  "Qty",
  "Unit Price",
  "Shipping",
  "COD Amount",
  "Notes",
];

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

/** For manual stores - creates new orders from a spreadsheet, unlike
 * ImportOrdersModal (which only ever updates orders that already exist). */
export default function ImportNewOrdersModal({ open, onClose, onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(null);
  const beginLoading = useLoadingStore((s) => s.begin);
  const endLoading = useLoadingStore((s) => s.end);

  function reset() {
    setFile(null);
    setPreview(null);
    setError("");
    setApplied(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    reset();
    onClose?.();
  }

  async function runPreview(nextFile) {
    setBusy(true);
    setError("");
    setApplied(null);
    try {
      setPreview(await ordersService.importOrders(nextFile, { apply: false }));
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

  async function onApply() {
    setBusy(true);
    setError("");
    beginLoading("Importing orders");
    try {
      const result = await ordersService.importOrders(file, { apply: true });
      setApplied(result);
      setPreview(result);
      onImported?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      endLoading();
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import orders"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {applied ? "Done" : "Cancel"}
          </Button>
          {!applied ? (
            <Button onClick={onApply} disabled={!preview || preview.to_create === 0} loading={busy}>
              {preview ? `Create ${preview.to_create} order${preview.to_create === 1 ? "" : "s"}` : "Create orders"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Creates a new order for every Order No this file has that doesn&apos;t already exist.
          Several rows sharing one Order No become one order with several line items. Order
          numbers that already exist are skipped, so re-uploading the same file is safe.
        </p>

        <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Expected columns
            </div>
            <button
              type="button"
              onClick={() => ordersService.downloadImportTemplate()}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Download template
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-600">{COLUMNS.join(" · ")}</div>
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPick}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-900"
          />
          {file ? <div className="mt-1 text-xs text-slate-500">{file.name}</div> : null}
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {busy && !preview ? <div className="text-sm text-slate-500">Reading file…</div> : null}

        {preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Rows" value={preview.total_rows} />
              <Stat label="Orders found" value={preview.orders_found} />
              <Stat label="To create" value={preview.to_create} tone="green" />
              <Stat
                label="Already exist"
                value={preview.skipped_existing_count}
                tone={preview.skipped_existing_count ? "amber" : "slate"}
              />
            </div>

            {applied ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Imported. {applied.created} order{applied.created === 1 ? " was" : "s were"} created.
              </div>
            ) : null}

            {preview.errors?.length ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {preview.errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            ) : null}

            {preview.skipped_existing?.length ? (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Already exist, skipped
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {preview.skipped_existing.join(", ")}
                  {preview.skipped_existing_count > preview.skipped_existing.length
                    ? ` … and ${preview.skipped_existing_count - preview.skipped_existing.length} more`
                    : ""}
                </div>
              </div>
            ) : null}

            {preview.samples?.length ? (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {applied ? "Orders created (sample)" : "Preview"}
                </div>
                <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-surface-border">
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {preview.samples.map((s) => (
                        <tr key={s.order_number} className="border-b border-surface-border last:border-0">
                          <td className="px-2 py-1.5 align-top font-medium text-slate-900">
                            {s.order_number}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">{s.customer_name}</td>
                          <td className="px-2 py-1.5 text-slate-500">
                            {s.items} item{s.items === 1 ? "" : "s"}
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
