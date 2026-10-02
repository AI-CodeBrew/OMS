"use client";

import { useState } from "react";
import Button from "../shared/Button";
import Modal from "../shared/Modal";
import financeService from "../../services/financeService";

/** Asked once, before the first integration connect or manual store
 * create - see lib/useBankDetailsGate.js, which wraps this around whatever
 * action should wait for it. Never shown again once the store has saved
 * one (gate checks that first). */
export default function BankDetailsModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState({
    accountTitle: "",
    bankName: "",
    accountNumber: "",
    iban: "",
    branchCode: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const details = await financeService.saveBankDetails(form);
      onSaved?.(details);
    } catch (err) {
      setError(err.message || "Could not save bank details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bank details"
      width="max-w-md"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bank-details-form" loading={saving}>
            Save and continue
          </Button>
        </>
      }
    >
      <form id="bank-details-form" onSubmit={onSubmit} className="space-y-3">
        <p className="text-sm text-slate-600">
          FynkTech remits your COD collections to this account. Asked once - you won&apos;t see
          this again once it&apos;s saved.
        </p>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Account title</span>
          <input
            required
            value={form.accountTitle}
            onChange={set("accountTitle")}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Bank name</span>
          <input
            required
            value={form.bankName}
            onChange={set("bankName")}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Account number</span>
            <input
              value={form.accountNumber}
              onChange={set("accountNumber")}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">IBAN</span>
            <input
              placeholder="PK.."
              value={form.iban}
              onChange={set("iban")}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
        </div>
        <p className="text-xs text-slate-400">Enter an account number or an IBAN (at least one).</p>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Branch code (optional)</span>
          <input
            value={form.branchCode}
            onChange={set("branchCode")}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
      </form>
    </Modal>
  );
}
