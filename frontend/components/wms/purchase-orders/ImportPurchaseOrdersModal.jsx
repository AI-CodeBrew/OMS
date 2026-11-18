"use client";

import { useRef, useState } from "react";
import Modal from "../../shared/Modal";
import Button from "../../shared/Button";
import wmsService from "../../../services/wmsService";

function Stat({ label, value, tone = "text-slate-900" }) {
  return (
    <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

const money = (v) => Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });

/**
 * Purchase Orders - Import (backend: wms/po_import.py): many POs from one CSV,
 * one row per product, rows with the same PO Ref make one PO. Good Received
 * goes into stock right away, exactly like Create PO. A preview first;
 * nothing is created while a row has a problem.
 */
export default function ImportPurchaseOrdersModal({ open, onClose, onImported }) {
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
      const result = await wmsService.importPurchaseOrders(nextFile, { apply });
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

  async function downloadTemplate() {
    setError("");
    try {
      await wmsService.downloadPurchaseOrderTemplate();
    } catch (err) {
      setError(err.message || "Could not download the template");
    }
  }

  const applied = preview?.applied;
  const ready = preview && !preview.problems && preview.po_count > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import purchase orders"
      width="max-w-4xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {applied ? "Done" : "Cancel"}
          </Button>
          {!applied ? (
            <Button onClick={() => run(file, true)} disabled={!ready} loading={busy}>
              {preview ? `Create ${preview.po_count} PO${preview.po_count === 1 ? "" : "s"}` : "Create POs"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Creates many purchase orders at once - one row per product; rows with the same <b>PO Ref</b> make one
          PO. <b>Good Received</b> units go into the warehouse&apos;s stock right away (to add inventory, put the
          quantity that arrived there). A blank <b>Warehouse</b> uses the default warehouse; a new{" "}
          <b>Supplier</b> name is added as a supplier.
        </p>

        <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Columns</div>
            <button type="button" onClick={downloadTemplate} className="text-xs font-medium text-brand-600 hover:underline">
              Download template
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            <b>PO Ref</b> · <b>Supplier</b> · Supplier Phone · Supplier City · Warehouse · Order Date · Logistics
            Cost · Note · <b>SKU</b> · Product Name · <b>Quantity Ordered</b> · Unit Price · Good Received · Damaged
            Received
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Bold = required. PO details (supplier to note) only need to be on a PO&apos;s first row. Order Date is
            dd/mm/yyyy (blank = now). A blank Product Name takes the inventory item&apos;s name for the SKU.
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
              <Stat label="POs" value={preview.po_count} />
              <Stat label="Products" value={preview.rows} />
              <Stat label="Units ordered" value={preview.units_ordered} />
              <Stat label="Into stock now" value={preview.units_good} tone="text-emerald-600" />
              <Stat label="Problems" value={preview.problems} tone={preview.problems ? "text-red-600" : "text-slate-900"} />
            </div>
            {applied ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Created {preview.created.join(", ")}. {preview.units_good} good unit
                {preview.units_good === 1 ? "" : "s"} added to stock.
              </div>
            ) : preview.problems ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Fix the problems below and choose the file again - nothing is created until every row is OK.
              </div>
            ) : preview.new_suppliers?.length ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                New supplier{preview.new_suppliers.length === 1 ? "" : "s"} will be added: {preview.new_suppliers.join(", ")}
              </div>
            ) : null}

            <div className="max-h-96 space-y-3 overflow-auto">
              {preview.pos.map((po) => (
                <div key={po.ref} className="rounded-md border border-surface-border">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-surface-border bg-surface px-3 py-2 text-xs">
                    <span className="font-semibold text-slate-900">{po.po_number || po.ref}</span>
                    <span className="text-slate-700">
                      {po.supplier || "—"}
                      {po.supplier_new ? (
                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">new</span>
                      ) : null}
                    </span>
                    <span className="text-slate-500">{po.warehouse || "—"}</span>
                    <span className="text-slate-500">{po.ordered_at}</span>
                    <span className="ml-auto text-slate-600">
                      Products {money(po.products_cost)} + logistics {money(po.logistics_cost)} ={" "}
                      <b>{money(po.total_cost)}</b>
                    </span>
                  </div>
                  {po.problems.length ? (
                    <div className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                      {po.problems.map((p) => (
                        <div key={p}>{p}</div>
                      ))}
                    </div>
                  ) : null}
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-2 py-1">Line</th>
                        <th className="px-2 py-1">SKU</th>
                        <th className="px-2 py-1">Product</th>
                        <th className="px-2 py-1 text-right">Ordered</th>
                        <th className="px-2 py-1 text-right">Unit price</th>
                        <th className="px-2 py-1 text-right">Good</th>
                        <th className="px-2 py-1 text-right">Damaged</th>
                        <th className="px-2 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {po.lines.map((l) => (
                        <tr key={l.line} className="border-t border-surface-border align-top">
                          <td className="px-2 py-1 text-slate-400">{l.line}</td>
                          <td className="px-2 py-1 font-medium text-slate-900">{l.sku || "—"}</td>
                          <td className="max-w-[220px] truncate px-2 py-1 text-slate-600" title={l.product_name}>
                            {l.product_name || "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{l.quantity_ordered}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{money(l.unit_price)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{l.good}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-amber-700">{l.damaged}</td>
                          <td className="px-2 py-1">
                            {l.problems.length ? (
                              <span className="text-red-600">{l.problems.join("; ")}</span>
                            ) : l.new_item ? (
                              <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">
                                new item
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
