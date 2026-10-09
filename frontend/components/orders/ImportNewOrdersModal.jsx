"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../shared/Button";
import Modal from "../shared/Modal";
import ordersService from "../../services/ordersService";
import useLoadingStore from "../../store/loadingStore";
import ImportDataEditorModal, { parseCsv, toCsv } from "./ImportDataEditorModal";

// Mirrors oms.order_importer.TEMPLATE_HEADERS / REQUIRED_COLUMNS.
const REQUIRED_COLUMNS = ["Order No", "Customer Name", "Phone", "Address", "City", "Product", "Qty", "Unit Price"];
const OPTIONAL_COLUMNS = [
  "Order Date",
  "Email",
  "Payment Method (COD / Prepaid)",
  "SKU",
  "Weight (grams)",
  "Shipping Charges",
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
// `initialFile`: a CSV already picked elsewhere (the Manual Order screen) -
// opened straight in the editor as if it had been picked here.
export default function ImportNewOrdersModal({ open, onClose, onImported, initialFile = null }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  // The sheet as parsed rows, edited in ImportDataEditorModal; `file` is
  // always rebuilt from it, so the edits are what gets imported.
  const [sheet, setSheet] = useState(null);
  const [fileName, setFileName] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
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
    setSheet(null);
    setFileName("");
    setEditorOpen(false);
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

  async function openInEditor(picked) {
    setError("");
    try {
      const [head = [], ...body] = parseCsv(await picked.text());
      if (head.length === 0) {
        setError("The file is empty.");
        return;
      }
      setFileName(picked.name);
      setSheet({ header: head, rows: body });
      setEditorOpen(true);
    } catch {
      setError("Could not read the file - please upload a UTF-8 CSV.");
    }
  }

  function onPick(event) {
    const picked = event.target.files?.[0];
    if (picked) openInEditor(picked);
  }

  useEffect(() => {
    if (open && initialFile) openInEditor(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  function onSaveEdits(header, rows) {
    setSheet({ header, rows });
    setEditorOpen(false);
    const edited = new File([toCsv(header, rows)], fileName || "orders.csv", { type: "text/csv" });
    setFile(edited);
    runPreview(edited);
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
    <>
    <ImportDataEditorModal
      open={open && editorOpen}
      header={sheet?.header || []}
      rows={sheet?.rows || []}
      onCancel={() => {
        setEditorOpen(false);
        // Backing out before the first save leaves nothing picked.
        if (!file) reset();
      }}
      onSave={onSaveEdits}
    />
    <Modal
      open={open && !editorOpen}
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
          <div className="mt-1 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Required:</span> {REQUIRED_COLUMNS.join(" · ")}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">Optional: {OPTIONAL_COLUMNS.join(" · ")}</div>
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPick}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-900"
          />
          {sheet ? (
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              <span>
                {fileName} · {sheet.rows.length} row{sheet.rows.length === 1 ? "" : "s"}
              </span>
              {!applied ? (
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  className="font-medium text-brand-600 hover:underline"
                >
                  View / edit data
                </button>
              ) : null}
            </div>
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
    </>
  );
}
