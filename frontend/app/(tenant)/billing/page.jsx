"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "../../../components/shared/Button";
import BankDetailsModal from "../../../components/billing/BankDetailsModal";
import financeService from "../../../services/financeService";
import useBankDetailsStore from "../../../store/bankDetailsStore";

function BankDetailsTab() {
  const details = useBankDetailsStore((s) => s.details);
  const ensureLoaded = useBankDetailsStore((s) => s.ensureLoaded);
  const setDetails = useBankDetailsStore((s) => s.setDetails);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    ensureLoaded().finally(() => setLoading(false));
  }, [ensureLoaded]);

  function onSaved(saved) {
    setDetails(saved);
    setEditing(false);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-slate-500">
        FynkTech remits your COD collections to this account.
      </p>

      {details ? (
        <div className="space-y-2 rounded-lg border border-surface-border bg-white p-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Account title</div>
            <div className="text-sm font-medium text-slate-900">{details.account_title}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Bank</div>
            <div className="text-sm font-medium text-slate-900">{details.bank_name}</div>
          </div>
          {details.account_number ? (
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Account number</div>
              <div className="text-sm font-medium text-slate-900">{details.account_number}</div>
            </div>
          ) : null}
          {details.iban ? (
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">IBAN</div>
              <div className="text-sm font-medium text-slate-900">{details.iban}</div>
            </div>
          ) : null}
          <div className="pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-surface-border bg-white p-5 text-center">
          <p className="text-sm text-slate-500">No bank details saved yet.</p>
          <Button type="button" className="mt-3" onClick={() => setEditing(true)}>
            Add bank details
          </Button>
        </div>
      )}

      <BankDetailsModal
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={onSaved}
      />
    </div>
  );
}

function InvoicesTab() {
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setInvoices(await financeService.listInvoices());
    } catch (err) {
      setError(err.message || "Failed to load invoices");
      setInvoices([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (invoices === null && !error) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  if (error) {
    return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }

  if (!invoices.length) {
    return (
      <p className="rounded-lg border border-dashed border-surface-border bg-white p-6 text-center text-sm text-slate-500">
        No invoices yet. Invoices FynkTech issues for dispatching your orders will show up here.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface/60 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Invoice</th>
            <th className="px-4 py-2">Period</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 text-right">Total</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td className="px-4 py-2 font-medium text-slate-900">{inv.number}</td>
              <td className="px-4 py-2 text-slate-600">
                {inv.period_start} – {inv.period_end}
              </td>
              <td className="px-4 py-2 capitalize text-slate-600">{inv.status}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-900">{inv.total}</td>
              <td className="px-4 py-2 text-right">
                <a
                  href={inv.print_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  View / Print
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BillingPage() {
  const [tab, setTab] = useState("invoices");

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Invoices</h1>
      <div className="mt-4 flex gap-1 border-b border-surface-border">
        <button
          type="button"
          onClick={() => setTab("invoices")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "invoices"
              ? "border-b-2 border-brand-600 text-brand-700"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Invoices
        </button>
        <button
          type="button"
          onClick={() => setTab("bank")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "bank"
              ? "border-b-2 border-brand-600 text-brand-700"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Bank details
        </button>
      </div>
      <div className="mt-6">
        {tab === "invoices" ? <InvoicesTab /> : null}
        {tab === "bank" ? <BankDetailsTab /> : null}
      </div>
    </div>
  );
}
