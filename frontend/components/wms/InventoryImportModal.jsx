"use client";

import { useRef, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import wmsService from "../../services/wmsService";

const STATUS_STYLE = {
  update: "bg-brand-100 text-brand-800",
  create: "bg-emerald-50 text-emerald-700",
  unchanged: "bg-slate-100 text-slate-600",
  error: "bg-red-50 text-red-700",
};
const STATUS_LABEL = { update: "Update", create: "New item", unchanged: "No change", error: "Problem" };

function Stat({ label, value, tone = "text-slate-900" }) {
  return (
    <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

/**
 * Inventory - Import: set many items' stock from one CSV (backend:
 * wms/inventory_io.py). Each change is a normal stock adjustment - a history
 * line, and for a Shopify-linked item it waits for Push to Shopify. Rows that
 * match no item become new items. Nothing is applied while a row has a problem.
 */
export default function InventoryImportModal({ open, onClose, onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setFile(null);
    setPreview(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    reset();
    onClose?.();
  }

  async function run(nextFile, apply) {
    setBusy(true);
    setError("");
    try {
      const result = await wmsService.importInventory(nextFile, { apply });
      setPreview(result);
      if (apply) onImported?.(result);
    } catch (err) {
      setError(err.message || "Import failed");
      if (!apply) setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function onPick(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    run(picked, false);
  }

  async function downloadSheet() {
    setError("");
    try {
      await wmsService.exportInventory();
    } catch (err) {
      setError(err.message || "Could not download the sheet");
    }
  }

  const applied = preview?.applied;
  const changes = preview ? preview.update + preview.create : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import inventory"
      width="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {applied ? "Done" : "Cancel"}
          </Button>
          {!applied ? (
            <Button onClick={() => run(file, true)} disabled={!preview || !changes || preview.error > 0} loading={busy}>
              {preview ? `Apply ${changes} change${changes === 1 ? "" : "s"}` : "Apply"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Sets each product&apos;s stock to the <b>Available</b> in your file. Changes are saved in the stock
          history, and for products linked to Shopify they wait for <b>Push to Shopify</b>. Products not
          found are added as new items.
        </p>

        <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Columns</div>
            <button type="button" onClick={downloadSheet} className="text-xs font-medium text-brand-600 hover:underline">
              Download current inventory (Export)
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-600">SKU · Product Name · Warehouse · Available · Reorder Level</div>
          <div className="mt-1 text-[11px] text-slate-400">
            Easiest: Export, change the Available column, and import the same file - other columns are ignored.
            SKU finds the product (else its exact name). Warehouse and Reorder Level can be left blank.
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onPick}
          disabled={busy || applied}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-900"
        />

        {error ? <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {busy && !preview ? <div className="text-sm text-slate-500">Reading file…</div> : null}

        {preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Rows" value={preview.rows} />
              <Stat label="Updates" value={preview.update} tone="text-brand-700" />
              <Stat label="New items" value={preview.create} tone="text-emerald-600" />
              <Stat label="No change" value={preview.unchanged} tone="text-slate-500" />
              <Stat label="Problems" value={preview.error} tone={preview.error ? "text-red-600" : "text-slate-900"} />
            </div>
            {applied ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Done - {preview.update} product{preview.update === 1 ? "" : "s"} updated, {preview.create} added.
              </div>
            ) : preview.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Fix the rows marked Problem and choose the file again - nothing is saved until every row is OK.
              </div>
            ) : null}
            <div className="max-h-80 overflow-auto rounded-md border border-surface-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Line</th>
                    <th className="px-2 py-1.5">SKU</th>
                    <th className="px-2 py-1.5">Product</th>
                    <th className="px-2 py-1.5">Warehouse</th>
                    <th className="px-2 py-1.5 text-right">Now</th>
                    <th className="px-2 py-1.5 text-right">New</th>
                    <th className="px-2 py-1.5 text-right">Change</th>
                    <th className="px-2 py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.results.map((r) => (
                    <tr key={r.line} className="border-t border-surface-border">
                      <td className="px-2 py-1.5 text-slate-400">{r.line}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-900">{r.sku || "—"}</td>
                      <td className="max-w-[200px] truncate px-2 py-1.5 text-slate-600" title={r.product_name}>
                        {r.product_name || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{r.warehouse || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.current ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.new ?? "—"}</td>
                      <td
                        className={`px-2 py-1.5 text-right tabular-nums ${
                          r.delta > 0 ? "text-emerald-700" : r.delta < 0 ? "text-red-600" : "text-slate-400"
                        }`}
                      >
                        {r.status === "error" ? "" : r.delta > 0 ? `+${r.delta}` : r.delta}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status] || ""}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                        {r.reason ? <span className="ml-1 text-slate-500">{r.reason}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.truncated ? (
              <p className="text-xs text-slate-500">Showing the first {preview.results.length} rows.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
