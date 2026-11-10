"use client";

import { useRef, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import wmsService from "../../services/wmsService";

const STATUS_STYLE = {
  ready: "bg-emerald-50 text-emerald-700",
  received: "bg-emerald-50 text-emerald-700",
  error: "bg-red-50 text-red-700",
};
const STATUS_LABEL = { ready: "Ready", received: "Received", error: "Not received" };

function Stat({ label, value, tone = "text-slate-900" }) {
  return (
    <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

/**
 * Returns desk - Import: receive many returned parcels from one file of
 * SKU-wise counts (backend: wms/returns_io.py). Each order goes through
 * exactly what a scan does - only Good units go back into stock, an order
 * already received is skipped. `filters`: the page's dates / search, for
 * the pre-filled sheet.
 */
export default function ReturnsImportModal({ open, onClose, onImported, filters = {} }) {
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
      const result = await wmsService.importReturns(nextFile, { apply });
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
      await wmsService.downloadReturnsImportSheet(filters);
    } catch (err) {
      setError(err.message || "Could not download the sheet");
    }
  }

  const applied = preview?.applied;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import returns"
      width="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {applied ? "Done" : "Cancel"}
          </Button>
          {!applied ? (
            <Button onClick={() => run(file, true)} disabled={!preview || !preview.ready} loading={busy}>
              {preview ? `Receive ${preview.ready} order${preview.ready === 1 ? "" : "s"}` : "Receive orders"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Receives many returned parcels at once - the same as scanning each one and counting its
          products. One row per product of an order with its <b>Good</b>, <b>Damaged</b> and{" "}
          <b>Lost</b> units; for every product Good + Damaged + Lost must equal its Qty. Only Good units
          go back into stock. Orders already received are skipped.
        </p>

        <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Columns</div>
            <button type="button" onClick={downloadSheet} className="text-xs font-medium text-brand-600 hover:underline">
              Download import sheet (Awaiting Scan orders)
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Store Order ID · CN · SKU · Product · Qty · Good · Damaged · Lost
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            The sheet lists every product of the orders Awaiting Scan with Good = Qty - change Damaged / Lost
            where needed. CN or Store Order ID finds the order; SKU (or Product) finds the line.
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
              <Stat label="Orders" value={preview.orders} />
              <Stat label={applied ? "Received" : "Ready"} value={applied ? preview.received : preview.ready} tone="text-emerald-600" />
              <Stat label="Problems" value={preview.problems} tone={preview.problems ? "text-red-600" : "text-slate-900"} />
              <Stat label="Good units" value={preview.good} />
              <Stat label="Damaged / Lost" value={`${preview.damaged} / ${preview.lost}`} />
            </div>
            {applied ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {preview.received} order{preview.received === 1 ? " was" : "s were"} received. Good units went back into stock.
              </div>
            ) : null}
            {preview.errors?.length ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {preview.errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            ) : null}
            <div className="max-h-80 overflow-auto rounded-md border border-surface-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Order</th>
                    <th className="px-2 py-1.5">CN</th>
                    <th className="px-2 py-1.5 text-right">Good</th>
                    <th className="px-2 py-1.5 text-right">Damaged</th>
                    <th className="px-2 py-1.5 text-right">Lost</th>
                    <th className="px-2 py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.results.map((r) => (
                    <tr key={`${r.order_number}|${r.cn}`} className="border-t border-surface-border">
                      <td className="px-2 py-1.5 font-medium text-slate-900">{r.order_number}</td>
                      <td className="px-2 py-1.5 text-slate-500">{r.cn || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{r.good}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{r.damaged}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-red-700">{r.lost}</td>
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
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
