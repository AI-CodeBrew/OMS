"use client";

import { useEffect, useState } from "react";
import Button from "../../../../../components/shared/Button";
import barqraftarService from "../_lib/barqraftarService";

export default function SettingsCard({ status, onChanged, onError, onNotice }) {
  const [form, setForm] = useState({
    default_weight_grams: 500,
    label_format: "a4",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      default_weight_grams: status.default_weight_grams ?? 500,
      label_format: status.label_format || "a4",
    });
  }, [status.default_weight_grams, status.label_format]);

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      await barqraftarService.updateSettings(form);
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
        {status.pickup_address_label || status.pickup_address_id ? (
          <p className="text-sm text-slate-800">
            {status.pickup_address_label || `Address #${status.pickup_address_id}`}
            {status.from_city_name ? (
              <span className="text-slate-500"> - ships from {status.from_city_name}</span>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-amber-600">
            Not set - required before booking. Set one as active on the Pickup Addresses tab.
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Every booking goes out from this address, with one BarqRaftar pickup request per booking
          (up to 25 orders each).
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Default weight (grams)</span>
        <input
          type="number"
          min="1"
          value={form.default_weight_grams}
          onChange={(e) => setForm((f) => ({ ...f, default_weight_grams: e.target.value }))}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Used only when an order's line items have no weight of their own.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Label format</span>
        <select
          value={form.label_format}
          onChange={(e) => setForm((f) => ({ ...f, label_format: e.target.value }))}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="a4">A4</option>
          <option value="6x4">6 x 4 (thermal)</option>
        </select>
      </label>

      <Button type="submit" variant="secondary" loading={saving} className="w-full">
        Save Settings
      </Button>
    </form>
  );
}
