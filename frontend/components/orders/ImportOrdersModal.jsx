"use client";

import { useMemo, useRef, useState } from "react";
import Button from "../shared/Button";
import Modal from "../shared/Modal";
import ordersService from "../../services/ordersService";
import useLoadingStore from "../../store/loadingStore";
import ImportDataEditorModal, { parseCsv, toCsv } from "./ImportDataEditorModal";
import { COURIER_SHEETS, courierSheet } from "./courierSheets";
import { STATUS_LABELS } from "./statusConfig";

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

// A courier export's rows that updated nothing, as the backend reports them
// (oms/importers.py _courier_unmatched_export).
const COURIER_UNMATCHED_CSV_COLUMNS = [
  ["order_number", "Order Reference"],
  ["cn", "Tracking Number"],
  ["status", "Status"],
  ["customer_name", "Customer Name"],
  ["phone", "Phone"],
  ["address", "Address"],
  ["city", "City"],
  ["product_name", "Product"],
  ["booking_date", "Booking Date"],
  ["reason", "Reason"],
];

const MATCHED_VIA_LABELS = {
  phone: "by phone",
  tracking: "by tracking no.",
  details: "by customer details",
};

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(fileName, header, rows) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function downloadUnmatchedCsv(rows, courierExport) {
  const columns = courierExport ? COURIER_UNMATCHED_CSV_COLUMNS : UNMATCHED_CSV_COLUMNS;
  downloadCsv(
    "unmatched_orders.csv",
    columns.map(([, label]) => label),
    rows.map((row) => columns.map(([key]) => row[key]))
  );
}

// Why a courier export's rows matched nothing (oms/importers.py _not_matched).
const UNMATCHED_KIND_LABELS = {
  not_in_oms: "Not in OMS",
  details_differ: "Phone found, details differ",
  ambiguous: "More than one order",
  no_details: "No phone / name / address in sheet",
};

// The fields an import can change, as the matched-orders list names them.
const CHANGE_LABELS = {
  status: "Status",
  tracking_number: "Tracking",
  courier: "Courier",
  courier_status: "Sub Status",
  delivered_at: "Delivered on",
  returned_at: "Returned on",
  dispatched_at: "Dispatched on",
  return_in_progress_at: "Return started",
  return_reason: "Return reason",
  invoice_number: "Invoice",
  payment_status: "Payment",
  tag: "Tag",
  courier_charges: "Delivery charges",
  shipping_amount: "Shipping",
  placed_at: "Order date",
};

const MATCHED_FILTERS = [
  { key: "all", label: "All" },
  { key: "update", label: "Will update" },
  { key: "same", label: "No change" },
  { key: "protected", label: "Final status kept" },
];

// Rows the list renders at once - the CSV has every one.
const MATCHED_SHOWN = 300;

function changeValue(field, value) {
  if (!value) return "—";
  if (field === "status") return STATUS_LABELS[value] || value;
  if (field === "payment_status") return value === "paid" ? "Paid" : value;
  if (field.endsWith("_at")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
  }
  return value;
}

function matchedKind(row) {
  if (row.protected) return "protected";
  return Object.keys(row.changes).length ? "update" : "same";
}

function downloadMatchedCsv(rows) {
  downloadCsv(
    "matched_orders.csv",
    [
      "OMS Order", "Sheet Reference", "Matched By", "Customer", "Phone", "Status Now", "New Status",
      "Status In Sheet", "OMS Tracking", "Sheet Tracking", "Changes",
    ],
    rows.map((row) => [
      row.order_number,
      row.sheet_ref,
      MATCHED_VIA_LABELS[row.matched_via] || "by order number",
      row.customer_name,
      row.phone,
      STATUS_LABELS[row.status] || row.status,
      row.changes.status ? changeValue("status", row.changes.status) : "",
      row.file_status,
      row.tracking_number,
      row.file_tracking,
      Object.entries(row.changes)
        .map(([field, value]) => `${CHANGE_LABELS[field] || field}: ${changeValue(field, value)}`)
        .join("; "),
    ])
  );
}

// Every order the sheet matched: as it is in OMS, what the sheet says about
// it, and what the import changes on it (backend: importers._matched_row).
function MatchedOrders({ rows, applied }) {
  const [filter, setFilter] = useState("all");
  const counts = useMemo(() => {
    const result = { all: rows.length, update: 0, same: 0, protected: 0 };
    rows.forEach((row) => {
      result[matchedKind(row)] += 1;
    });
    return result;
  }, [rows]);
  const visible = filter === "all" ? rows : rows.filter((row) => matchedKind(row) === filter);
  const shown = visible.slice(0, MATCHED_SHOWN);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Matched orders ({rows.length})
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {MATCHED_FILTERS.filter((f) => f.key !== "protected" || counts.protected).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                filter === f.key ? "bg-brand-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.label} {counts[f.key]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => downloadMatchedCsv(rows)}
            className="ml-2 text-xs font-medium text-brand-600 hover:underline"
          >
            Download CSV
          </button>
        </div>
      </div>
      <div className="mt-1 max-h-80 overflow-auto rounded-md border border-surface-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Order</th>
              <th className="px-2 py-1.5">Customer</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5">Tracking</th>
              <th className="px-2 py-1.5">In the sheet</th>
              <th className="px-2 py-1.5">{applied ? "Changed" : "Will change"}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const kind = matchedKind(row);
              const sheetRef = String(row.sheet_ref || "").replace(/^#/, "");
              return (
                <tr key={`${row.order_number}|${row.sheet_ref}`} className="border-t border-surface-border align-top">
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-slate-900">{row.order_number}</div>
                    {sheetRef && sheetRef !== String(row.order_number).replace(/^#/, "") ? (
                      <div className="text-[10px] text-slate-400">sheet: {row.sheet_ref}</div>
                    ) : null}
                    {MATCHED_VIA_LABELS[row.matched_via] ? (
                      <span className="mt-0.5 inline-block rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700">
                        {MATCHED_VIA_LABELS[row.matched_via]}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="max-w-[9rem] truncate text-slate-700" title={row.customer_name}>
                      {row.customer_name || "—"}
                    </div>
                    <div className="text-[10px] text-slate-400">{row.phone}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                    {STATUS_LABELS[row.status] || row.status}
                    {row.changes.status ? (
                      <>
                        {" → "}
                        <span className="font-semibold text-emerald-700">{changeValue("status", row.changes.status)}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{row.tracking_number || "—"}</td>
                  <td className="px-2 py-1.5">
                    <div className="max-w-[9rem] truncate text-slate-700" title={row.file_status}>
                      {row.file_status || "—"}
                    </div>
                    <div className="text-[10px] text-slate-400">{row.file_tracking}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    {kind === "same" ? (
                      <span className="text-slate-400">No change</span>
                    ) : (
                      <div className="space-y-0.5">
                        {kind === "protected" ? <div className="text-amber-700">Final status kept</div> : null}
                        {Object.entries(row.changes).map(([field, value]) => (
                          <div key={field} className="text-slate-600">
                            <span className="text-slate-400">{CHANGE_LABELS[field] || field}:</span>{" "}
                            {changeValue(field, value)}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-slate-400">
                  Nothing here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {visible.length > shown.length ? (
        <div className="mt-1 text-[11px] text-slate-400">
          Showing {shown.length} of {visible.length} - the CSV has all of them.
        </div>
      ) : null}
    </div>
  );
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

// `stores` is only passed in the Dispatch Hub, where the sheet has to be
// pointed at one of its stores. `courier` (a COURIER_SHEETS key) fixes which
// courier's export this is - a courier's integration page passes it; without
// it the user picks one first.
export default function ImportOrdersModal({ open, onClose, onImported, stores = null, courier = "" }) {
  const inputRef = useRef(null);
  const [store, setStore] = useState("");
  // Which sheet this is - see courierSheets.js.
  const [formatKey, setFormatKey] = useState(courier);
  // The uploaded sheet as parsed rows, edited in ImportDataEditorModal;
  // `file` below is always rebuilt from it, so edits are what gets imported.
  const [sheet, setSheet] = useState(null);
  const [fileName, setFileName] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overwriteFinal, setOverwriteFinal] = useState(false);
  const [applied, setApplied] = useState(null);
  const beginLoading = useLoadingStore((s) => s.begin);
  const endLoading = useLoadingStore((s) => s.end);

  const format = courierSheet(formatKey);
  // Sent to the backend - empty for the aggregator's sheet.
  const courierParam = format?.courier ? format.key : "";

  function clearUpload() {
    setFile(null);
    setPreview(null);
    setError("");
    setApplied(null);
    setOverwriteFinal(false);
    setSheet(null);
    setFileName("");
    setEditorOpen(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function reset() {
    clearUpload();
    setStore("");
    setFormatKey(courier);
  }

  function pickFormat(key) {
    clearUpload();
    setFormatKey(key);
  }

  function close() {
    reset();
    onClose?.();
  }

  async function runPreview(nextFile, nextOverwrite = overwriteFinal, nextStore = store) {
    if (stores && !nextStore) {
      setPreview(null);
      return;
    }
    setBusy(true);
    setError("");
    setApplied(null);
    try {
      const result = await ordersService.importCsv(nextFile, {
        apply: false,
        overwriteFinal: nextOverwrite,
        store: nextStore,
        courier: courierParam,
      });
      setPreview(result);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  // Opens the picked sheet in the full-size editor first; the preview runs
  // on whatever the user saves from there.
  async function onPick(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;
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

  function onSaveEdits(header, rows) {
    setSheet({ header, rows });
    setEditorOpen(false);
    const edited = new File([toCsv(header, rows)], fileName || "import.csv", { type: "text/csv" });
    setFile(edited);
    runPreview(edited);
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
    beginLoading("Importing orders");
    try {
      const result = await ordersService.importCsv(file, {
        apply: true,
        overwriteFinal,
        store,
        courier: courierParam,
      });
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

  const statusMoves = Object.entries(preview?.by_status || {}).sort((a, b) => b[1] - a[1]);
  const movedCount = statusMoves.reduce((sum, [, count]) => sum + count, 0);
  const notFound = (preview?.unmatched || 0) + (preview?.ambiguous || 0);

  return (
    <>
    <ImportDataEditorModal
      open={editorOpen}
      header={sheet?.header || []}
      rows={sheet?.rows || []}
      onCancel={() => {
        setEditorOpen(false);
        // Backing out before the first save leaves nothing picked.
        if (!file) clearUpload();
      }}
      onSave={onSaveEdits}
    />
    <Modal
      open={open && !editorOpen}
      onClose={close}
      title={format?.courier ? `Import ${format.label} export` : "Import courier sheet"}
      width="max-w-4xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {applied ? "Done" : "Cancel"}
          </Button>
          {format && !applied ? (
            <Button
              onClick={onApply}
              disabled={!preview || preview.to_update === 0}
              loading={busy}
            >
              {preview ? `Update ${preview.to_update} order${preview.to_update === 1 ? "" : "s"}` : "Update orders"}
            </Button>
          ) : null}
        </>
      }
    >
      {!format ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Which courier is this sheet from? Each courier&apos;s own export is read as their portal
            downloads it.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {COURIER_SHEETS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => pickFormat(option.key)}
                className="rounded-md border border-surface-border bg-white px-3 py-3 text-left transition hover:border-brand-500 hover:bg-brand-50/40"
              >
                <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{option.pickerNote}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
      <div className="space-y-4">
        {!courier && !applied ? (
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Sheet: <span className="font-semibold text-slate-800">{format.label}</span>
            </span>
            <button
              type="button"
              onClick={() => pickFormat("")}
              className="font-medium text-brand-600 hover:underline"
            >
              Change
            </button>
          </div>
        ) : null}

        {format.courier ? (
          <p className="text-sm text-slate-600">
            Upload {format.label}&apos;s own export, as their portal downloads it (CSV). Each row is
            matched to an order by its order number, then its tracking number, and failing both by
            the customer&apos;s phone, name and address (and product, when the sheet has it) - only
            when that points at a single order. Matched orders move to the status {format.label}{" "}
            reports, out of New. Every matched order without a tracking number or courier gets the
            sheet&apos;s, and {format.label}&apos;s own status becomes its Sub Status. Nothing is
            created, and delivered / returned / cancelled orders only change status if you say so.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Matches rows to existing orders by order number and fills in what the courier knows:
            delivery status (its wording shows as the Sub Status), tag, CN / tracking number,
            courier, delivery charges and invoice number.
            It never creates orders. If a row&apos;s order number isn&apos;t found and the sheet has a
            phone column, it falls back to matching by phone - narrowed by product name or order
            date when one phone number covers more than one order.
          </p>
        )}

        <div className="rounded-md border border-surface-border bg-surface/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {format.courier ? "Columns used" : "Expected columns"}
            </div>
            <button
              type="button"
              onClick={() => downloadCsv(`${format.key}_sample.csv`, format.columns, format.sampleRows)}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Download sample file
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-600">{format.uses.join(" · ")}</div>
          {format.courier ? (
            <div className="mt-1 text-[11px] text-slate-400">
              The export&apos;s other columns are ignored.
            </div>
          ) : (
            <>
              <div className="mt-1 text-[11px] text-slate-400">
                Optional fallback columns: {format.optional.join(" · ")}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Courier: BarqRaftar · PostEx · Smartlane · TCS · Leopards · Trax · MNP (spacing and
                case don&apos;t matter). Status: Delivered · Returned · Cancelled · In Transit · Out for
                Delivery · Attempted. Dates: 15/08/2026 or 15 Aug 2026.
              </div>
            </>
          )}
        </div>

        {stores ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Store</span>
            <select
              value={store}
              onChange={(e) => {
                setStore(e.target.value);
                if (file) runPreview(file, overwriteFinal, e.target.value);
              }}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">Choose the store this sheet is for…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Rows" value={preview.total_rows} />
              <Stat label="Matched" value={preview.matched} />
              <Stat label="To update" value={preview.to_update} tone="green" />
              <Stat label="Unchanged" value={preview.unchanged} />
              <Stat label="Not found" value={notFound} tone={notFound ? "amber" : "slate"} />
            </div>

            {statusMoves.length ? (
              <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                <div className="font-medium">
                  {applied ? "Moved" : "Will move"} {movedCount} order{movedCount === 1 ? "" : "s"}
                  {preview.from_new ? ` (${preview.from_new} out of New)` : ""}:
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {statusMoves.map(([status, count]) => (
                    <span key={status}>
                      {STATUS_LABELS[status] || status}:{" "}
                      <span className="font-semibold tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.matched_by_phone > 0 ? (
              <div className="text-xs text-slate-500">
                Includes {preview.matched_by_phone} order
                {preview.matched_by_phone === 1 ? "" : "s"} matched by phone number (order id not
                found).
              </div>
            ) : null}

            {preview.matched_by_tracking > 0 || preview.matched_by_details > 0 ? (
              <div className="text-xs text-slate-500">
                Order number not found for {preview.matched_by_tracking + preview.matched_by_details} of
                them: {preview.matched_by_tracking} matched by tracking number,{" "}
                {preview.matched_by_details} by the customer&apos;s phone, name and address.
              </div>
            ) : null}

            {applied ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Imported. {applied.to_update} order
                {applied.to_update === 1 ? " was" : "s were"} updated.
              </div>
            ) : null}

            {preview.unknown_statuses?.length ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Status not recognised - these keep their current status (the tracking number is still
                saved): {preview.unknown_statuses.map((u) => `${u.status} (${u.count})`).join(" · ")}
              </div>
            ) : null}

            {preview.ambiguous > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {preview.ambiguous} row{preview.ambiguous === 1 ? " matches" : "s match"} more than
                one order (a repeat customer with the same details) and{" "}
                {preview.ambiguous === 1 ? "was" : "were"} left alone - see the not-found download.
              </div>
            ) : null}

            {preview.protected > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <div>
                  {preview.protected} order{preview.protected === 1 ? " is" : "s are"} already in a
                  final state (delivered / returned / cancelled) that this sheet disagrees with. Their
                  status is kept - a missing tracking number or courier is still filled in, and the
                  sheet&apos;s status shows as their Sub Status.
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

            {preview.unmatched_rows?.length ? (
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {format.courier ? "Rows not matched" : "Order numbers not found"}
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadUnmatchedCsv(preview.unmatched_rows, format.courier)}
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    Download CSV
                  </button>
                </div>
                {Object.keys(preview.unmatched_reasons || {}).length ? (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {Object.entries(preview.unmatched_reasons)
                      .sort((a, b) => b[1] - a[1])
                      .map(([kind, count]) => (
                        <span key={kind}>
                          {UNMATCHED_KIND_LABELS[kind] || kind}:{" "}
                          <span className="font-semibold tabular-nums">{count}</span>
                        </span>
                      ))}
                  </div>
                ) : null}
                {preview.unmatched_samples?.length ? (
                  <div className="mt-1 text-xs text-slate-600">
                    {preview.unmatched_samples.join(", ")}
                    {preview.unmatched > preview.unmatched_samples.length
                      ? ` … and ${preview.unmatched - preview.unmatched_samples.length} more`
                      : ""}
                  </div>
                ) : null}
                {format.courier ? (
                  <div className="mt-1 text-[11px] text-slate-400">
                    The CSV gives each row&apos;s reason - e.g. which order has the same phone and what
                    differs.
                  </div>
                ) : null}
              </div>
            ) : null}

            {preview.matched_rows?.length ? <MatchedOrders rows={preview.matched_rows} applied={applied} /> : null}
          </div>
        ) : null}
      </div>
      )}
    </Modal>
    </>
  );
}
