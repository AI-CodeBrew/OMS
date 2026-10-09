"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../shared/Button";
import Modal from "../shared/Modal";

const PAGE_SIZE = 100;

// RFC 4180-ish: quoted fields, "" escapes, commas/newlines inside quotes,
// CRLF or LF line endings, and the BOM Excel writes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully blank lines (trailing newline, empty spreadsheet rows).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// Full-width, editable view of an uploaded sheet. Edits stay local until
// Save, which hands the edited header/rows back to the caller.
export default function ImportDataEditorModal({ open, header, rows, onCancel, onSave }) {
  const [draft, setDraft] = useState([]);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    // Pad/trim every row to the header's width so each column is editable.
    setDraft(rows.map((r) => header.map((_, i) => r[i] ?? "")));
    setPage(1);
    setFilter("");
  }, [open, header, rows]);

  // Indexes into `draft`, so edits on a filtered view land on the right row.
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const all = draft.map((_, i) => i);
    if (!term) return all;
    return all.filter((i) => draft[i].some((cell) => cell.toLowerCase().includes(term)));
  }, [draft, filter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function updateCell(rowIndex, colIndex, value) {
    setDraft((prev) => {
      const next = prev.slice();
      next[rowIndex] = next[rowIndex].slice();
      next[rowIndex][colIndex] = value;
      return next;
    });
  }

  function deleteRow(rowIndex) {
    setDraft((prev) => prev.filter((_, i) => i !== rowIndex));
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Review & edit sheet data (${draft.length} row${draft.length === 1 ? "" : "s"})`}
      width="max-w-[95vw]"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(header, draft)} disabled={draft.length === 0}>
            Save &amp; preview
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Fix anything in the sheet before it&apos;s matched to orders. Nothing is written until
            you save here and then confirm &ldquo;Update orders&rdquo;.
          </p>
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Search rows…"
            className="w-56 rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border border-surface-border">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-2 py-2">#</th>
                {header.map((col, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <th key={i} className="min-w-[9rem] whitespace-nowrap px-2 py-2">
                    {col || `Column ${i + 1}`}
                  </th>
                ))}
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((rowIndex) => (
                <tr key={rowIndex} className="border-t border-surface-border">
                  <td className="px-2 py-1 text-slate-400 tabular-nums">{rowIndex + 1}</td>
                  {header.map((_, colIndex) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <td key={colIndex} className="px-1 py-0.5">
                      <input
                        value={draft[rowIndex][colIndex]}
                        onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                        className="w-full rounded border border-transparent px-1.5 py-1 text-xs text-slate-800 outline-none hover:border-surface-border focus:border-brand-500 focus:bg-white"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => deleteRow(rowIndex)}
                      title="Remove this row from the import"
                      className="text-slate-300 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={header.length + 2} className="px-3 py-6 text-center text-slate-500">
                    No rows match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="flex items-center justify-end gap-2 text-xs text-slate-600">
            <Button variant="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </Button>
            <span>
              Page {currentPage} of {pageCount}
            </span>
            <Button
              variant="secondary"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
