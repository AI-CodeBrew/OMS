"use client";

import { useEffect, useState } from "react";
import Button from "../../../../../components/shared/Button";
import leopardsService from "../_lib/leopardsService";

const INPUT =
  "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

export default function SettingsCard({ status, onChanged, onError, onNotice }) {
  const [form, setForm] = useState({
    origin_city_id: "",
    default_weight_grams: 500,
    default_shipment_type: "",
    default_notes: "",
    load_sheet_courier_name: "",
    load_sheet_courier_code: "",
  });
  const [originCities, setOriginCities] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      origin_city_id: status.origin_city_id ? String(status.origin_city_id) : "",
      default_weight_grams: status.default_weight_grams ?? 500,
      default_shipment_type: status.default_shipment_type || "",
      default_notes: status.default_notes || "",
      load_sheet_courier_name: status.load_sheet_courier_name || "",
      load_sheet_courier_code: status.load_sheet_courier_code || "",
    });
  }, [
    status.origin_city_id,
    status.default_weight_grams,
    status.default_shipment_type,
    status.default_notes,
    status.load_sheet_courier_name,
    status.load_sheet_courier_code,
  ]);

  // The cities parcels can leave from - cached by the backend (24h).
  useEffect(() => {
    leopardsService
      .getCities()
      .then((d) => setOriginCities((d.cities || []).filter((c) => c.origin !== false)))
      .catch(() => {});
  }, []);

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      await leopardsService.updateSettings({
        ...form,
        origin_city_id: form.origin_city_id ? Number(form.origin_city_id) : null,
        default_weight_grams: Number(form.default_weight_grams),
      });
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

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Origin city</span>
        <select
          value={form.origin_city_id}
          onChange={(e) => setForm((f) => ({ ...f, origin_city_id: e.target.value }))}
          className={INPUT}
        >
          <option value="">Account&apos;s own city (default)</option>
          {originCities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-500">
          Where Leopards collects parcels from. Leave on the default unless you ship from another city than the
          one registered on your Leopards account.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Default weight (grams)</span>
        <input
          type="number"
          min={1}
          max={100000}
          value={form.default_weight_grams}
          onChange={(e) => setForm((f) => ({ ...f, default_weight_grams: e.target.value }))}
          className={INPUT}
        />
        <span className="mt-1 block text-xs text-slate-500">Used when none of an order&apos;s items has a weight.</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Shipment type</span>
        <input
          value={form.default_shipment_type}
          maxLength={50}
          onChange={(e) => setForm((f) => ({ ...f, default_shipment_type: e.target.value }))}
          placeholder="Leave empty for Leopards' default (overnight)"
          className={INPUT}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Notes for the rider</span>
        <input
          value={form.default_notes}
          maxLength={255}
          onChange={(e) => setForm((f) => ({ ...f, default_notes: e.target.value }))}
          placeholder="e.g. Handle with care. Call before delivery."
          className={INPUT}
        />
        <span className="mt-1 block text-xs text-slate-500">Sent with every Leopards booking.</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Load sheet courier name</span>
          <input
            value={form.load_sheet_courier_name}
            maxLength={100}
            onChange={(e) => setForm((f) => ({ ...f, load_sheet_courier_name: e.target.value }))}
            className={INPUT}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Load sheet courier code</span>
          <input
            value={form.load_sheet_courier_code}
            maxLength={30}
            onChange={(e) => setForm((f) => ({ ...f, load_sheet_courier_code: e.target.value }))}
            className={INPUT}
            required
          />
        </label>
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        Leopards asks for a courier name and code when it makes a load sheet - change them if Leopards tells you what
        it expects.
      </p>

      <Button type="submit" variant="secondary" loading={saving} className="w-full">
        Save Settings
      </Button>
    </form>
  );
}
