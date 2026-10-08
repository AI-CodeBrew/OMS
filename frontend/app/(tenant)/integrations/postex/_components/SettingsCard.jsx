"use client";

import { useEffect, useState } from "react";
import Button from "../../../../../components/shared/Button";
import postexService from "../_lib/postexService";

const ORDER_TYPES = ["Normal", "Reversed", "Replacement"];

export default function SettingsCard({ status, onChanged, onError, onNotice }) {
  const [form, setForm] = useState({ default_order_type: "Normal", default_notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      default_order_type: status.default_order_type || "Normal",
      default_notes: status.default_notes || "",
    });
  }, [status.default_order_type, status.default_notes]);

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      await postexService.updateSettings(form);
      onNotice("Settings saved.");
      onChanged();
    } catch (err) {
      onError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-4 rounded-lg border border-surface-border bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Booking Settings</h2>

      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Active pickup address</div>
        {status.pickup_address_code ? (
          <p className="text-sm text-slate-800">
            {status.pickup_address_label || "Address"}{" "}
            <span className="text-slate-500">
              (code {status.pickup_address_code}
              {status.pickup_city_name ? `, ${status.pickup_city_name}` : ""})
            </span>
          </p>
        ) : (
          <p className="text-sm text-amber-600">
            Not set - required before booking. Set one as active on the Pickup Addresses tab.
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">PostEx collects every booking from this address.</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Order type</span>
        <select
          value={form.default_order_type}
          onChange={(e) => setForm((f) => ({ ...f, default_order_type: e.target.value }))}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {ORDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Notes for the rider</span>
        <input
          value={form.default_notes}
          maxLength={255}
          onChange={(e) => setForm((f) => ({ ...f, default_notes: e.target.value }))}
          placeholder="e.g. Handle with care. Call before delivery."
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <span className="mt-1 block text-xs text-slate-500">Sent with every PostEx booking.</span>
      </label>

      <Button type="submit" variant="secondary" loading={saving} className="w-full">
        Save Settings
      </Button>
    </form>
  );
}
