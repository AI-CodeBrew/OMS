"use client";

import { useEffect, useState } from "react";
import Modal from "../../shared/Modal";
import Button from "../../shared/Button";

// Add Supplier / Add Warehouse: a few text fields, `required` ones must be
// filled. `fields` is [{key, label, required, multiline}]; onSubmit gets
// {key: value} and throws to show its message.
export default function SimpleFormModal({ open, title, fields, submitLabel = "Save", onSubmit, onClose }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setValues({});
      setError("");
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const missing = fields.filter((f) => f.required && !(values[f.key] || "").trim());

  async function submit(e) {
    e.preventDefault();
    if (missing.length) return;
    setSaving(true);
    setError("");
    try {
      await onSubmit(
        Object.fromEntries(fields.map((f) => [f.key, (values[f.key] || "").trim()]))
      );
    } catch (err) {
      setError(err.message || "Could not save");
      setSaving(false);
    }
  }

  const input =
    "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

  return (
    <Modal open title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              {f.label}
              {f.required ? <span className="text-red-600"> *</span> : null}
            </span>
            {f.multiline ? (
              <textarea
                rows={2}
                value={values[f.key] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={input}
              />
            ) : (
              <input
                value={values[f.key] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={input}
              />
            )}
          </label>
        ))}
        {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={missing.length > 0}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
