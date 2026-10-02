"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import invoicesAdminService from "../../../../../services/invoicesAdminService";
import Button from "../../../../../components/shared/Button";

function emptyLine() {
  return { description: "", quantity: "1", unit_price: "0", kind: "manual" };
}

function lineAmount(line) {
  const qty = Number(line.quantity) || 0;
  const rate = Number(line.unit_price) || 0;
  return (qty * rate).toFixed(2);
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState(null);
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const inv = await invoicesAdminService.get(id);
      setInvoice(inv);
      setLines(
        inv.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          kind: l.kind,
        }))
      );
      setNotes(inv.notes || "");
      setDueDate(inv.due_date || "");
    } catch (err) {
      setError(err.message || "Failed to load the invoice");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isDraft = invoice?.status === "draft";
  const total = lines.reduce((sum, l) => sum + Number(lineAmount(l)), 0);

  function updateLine(index, field, value) {
    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function removeLine(index) {
    setLines((rows) => rows.filter((_, i) => i !== index));
  }

  async function onSaveLines() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const sanitized = lines.map((l) => ({
        ...l,
        description: l.description || "Line item",
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
      }));
      const saved = await invoicesAdminService.saveLines(id, sanitized);
      setInvoice(saved);
      setSuccess("Saved.");
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveNotes() {
    setSaving(true);
    setError("");
    try {
      const saved = await invoicesAdminService.saveNotes(id, { notes, dueDate });
      setInvoice(saved);
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function onIssue() {
    if (!window.confirm("Issue this invoice? It becomes visible to the store and can't be edited afterwards.")) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      setInvoice(await invoicesAdminService.issue(id));
    } catch (err) {
      setError(err.message || "Could not issue the invoice");
    } finally {
      setSaving(false);
    }
  }

  async function onMarkPaid() {
    if (!window.confirm("Mark this invoice as paid?")) return;
    setSaving(true);
    setError("");
    try {
      setInvoice(await invoicesAdminService.markPaid(id));
    } catch (err) {
      setError(err.message || "Could not update the invoice");
    } finally {
      setSaving(false);
    }
  }

  async function onVoid() {
    if (!window.confirm("Void this invoice? This can't be undone.")) return;
    setSaving(true);
    setError("");
    try {
      setInvoice(await invoicesAdminService.voidInvoice(id));
    } catch (err) {
      setError(err.message || "Could not void the invoice");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!invoice) return <p className="text-sm text-red-700">{error || "Invoice not found"}</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.push("/admin/invoices")}
            className="mb-2 text-xs font-medium text-brand-600 hover:underline"
          >
            ← All invoices
          </button>
          <h1 className="text-2xl font-semibold text-slate-900">
            {invoice.number || "Draft"} · {invoice.store_name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {invoice.period_start} – {invoice.period_end} ·{" "}
            <span className="capitalize">{invoice.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => invoicesAdminService.openPrint(id)}>
            Print
          </Button>
          {isDraft ? (
            <Button type="button" onClick={onIssue} loading={saving}>
              Issue
            </Button>
          ) : null}
          {invoice.status === "issued" ? (
            <Button type="button" onClick={onMarkPaid} loading={saving}>
              Mark paid
            </Button>
          ) : null}
          {(isDraft || invoice.status === "issued") && (
            <Button type="button" variant="danger" onClick={onVoid} loading={saving}>
              Void
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Description</th>
              <th className="w-24 px-4 py-2 text-right">Qty</th>
              <th className="w-28 px-4 py-2 text-right">Rate</th>
              <th className="w-28 px-4 py-2 text-right">Amount</th>
              {isDraft ? <th className="w-10 px-4 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  {isDraft ? (
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(i, "description", e.target.value)}
                      className="w-full rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                    />
                  ) : (
                    line.description
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {isDraft ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => updateLine(i, "quantity", e.target.value)}
                      className="w-full rounded-md border border-surface-border px-2 py-1.5 text-right text-sm outline-none focus:border-brand-500"
                    />
                  ) : (
                    line.quantity
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {isDraft ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_price}
                      onChange={(e) => updateLine(i, "unit_price", e.target.value)}
                      className="w-full rounded-md border border-surface-border px-2 py-1.5 text-right text-sm outline-none focus:border-brand-500"
                    />
                  ) : (
                    line.unit_price
                  )}
                </td>
                <td className="px-4 py-2 text-right font-medium text-slate-900">
                  {lineAmount(line)}
                </td>
                {isDraft ? (
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {isDraft ? (
          <div className="flex items-center justify-between border-t border-surface-border px-4 py-3">
            <button
              type="button"
              onClick={() => setLines((rows) => [...rows, emptyLine()])}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              + Add line
            </button>
            <div className="text-sm font-semibold text-slate-900">Total: Rs {total.toFixed(2)}</div>
          </div>
        ) : (
          <div className="flex justify-end border-t border-surface-border px-4 py-3 text-sm font-semibold text-slate-900">
            Total: Rs {invoice.total}
          </div>
        )}
      </div>

      {isDraft ? (
        <Button type="button" onClick={onSaveLines} loading={saving}>
          Save lines
        </Button>
      ) : null}

      <div className="space-y-3 rounded-lg border border-surface-border bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Notes &amp; due date</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Due date</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Notes (shown on the printed invoice)</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <Button type="button" variant="secondary" onClick={onSaveNotes} loading={saving}>
          Save notes
        </Button>
      </div>
    </div>
  );
}
