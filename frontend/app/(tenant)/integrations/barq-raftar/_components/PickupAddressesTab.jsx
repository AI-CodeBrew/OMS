"use client";

import { useEffect, useState } from "react";
import Button from "../../../../../components/shared/Button";
import barqraftarService from "../_lib/barqraftarService";

const EMPTY_FORM = {
  name: "",
  address: "",
  city_id: "",
  person_of_contact: "",
  phone_number: "",
  set_default: true,
};

// Real BarqRaftar pickup-address shape (confirmed live): id, name, address,
// city_id (a string, e.g. "1"), city {id, name}, person_of_contact,
// phone_number. BarqRaftar has no working "edit" - sending an existing id
// to their store API creates a new address instead - so this tab only adds.
export default function PickupAddressesTab({ status, onChanged, onError, onNotice }) {
  const [addresses, setAddresses] = useState(null);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingActiveId, setSettingActiveId] = useState(null);

  async function load() {
    setLoading(true);
    onError("");
    try {
      const data = await barqraftarService.getPickupAddresses();
      setAddresses(data.addresses || []);
    } catch (err) {
      onError(err.message || "Failed to load pickup addresses");
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    barqraftarService
      .getCities()
      .then((data) => setCities(data.cities || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cityName(cityId) {
    return cities.find((c) => String(c.id) === String(cityId))?.name || "";
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      await barqraftarService.savePickupAddress({ ...form, city_name: cityName(form.city_id) });
      onNotice(form.set_default ? "Pickup address added and set as active." : "Pickup address added.");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      if (form.set_default) onChanged();
    } catch (err) {
      onError(err.message || "Failed to save pickup address");
    } finally {
      setSaving(false);
    }
  }

  async function onSetActive(row) {
    if (!window.confirm(`Make "${row.name || row.address}" the active pickup address? New bookings go out from here.`)) {
      return;
    }
    setSettingActiveId(row.id);
    onError("");
    try {
      // The origin city (from_city_id) every booking needs comes from the
      // active pickup address - so it's saved in the same breath.
      await barqraftarService.updateSettings({
        pickup_address_id: String(row.id),
        pickup_address_label: row.name || row.address || "",
        from_city_id: String(row.city_id ?? row.city?.id ?? ""),
        from_city_name: row.city?.name || cityName(row.city_id),
      });
      onNotice("Active pickup address updated - new bookings go out from here.");
      onChanged();
    } catch (err) {
      onError(err.message || "Failed to set active pickup address");
    } finally {
      setSettingActiveId(null);
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Pickup Addresses</h3>
        <Button variant="secondary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "Add Address"}
        </Button>
      </div>

      {showForm ? (
        <form onSubmit={onSubmit} className="mb-4 space-y-3 rounded-md border border-surface-border p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Name</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Main Warehouse"
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">City</span>
              <select
                required
                value={form.city_id}
                onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              >
                <option value="">Select a city…</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Address</span>
            <input
              required
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Contact person</span>
              <input
                required
                value={form.person_of_contact}
                onChange={(e) => setForm((f) => ({ ...f, person_of_contact: e.target.value }))}
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Phone</span>
              <input
                required
                value={form.phone_number}
                onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
                placeholder="03001234567"
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.set_default}
              onChange={(e) => setForm((f) => ({ ...f, set_default: e.target.checked }))}
              className="h-4 w-4 rounded border-surface-border"
            />
            Make this the active pickup address
          </label>
          <Button type="submit" loading={saving}>
            Save Address
          </Button>
        </form>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !addresses || addresses.length === 0 ? (
        <p className="text-sm text-slate-500">No pickup addresses yet - add one above.</p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {addresses.map((row) => {
            const isActive = String(row.id) === String(status.pickup_address_id);
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {row.name || `Address #${row.id}`}{" "}
                    <span className="text-xs font-normal text-slate-400">#{row.id}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.address}
                    {row.city?.name ? ` - ${row.city.name}` : ""}
                  </div>
                  {row.person_of_contact || row.phone_number ? (
                    <div className="text-xs text-slate-400">
                      {row.person_of_contact} {row.phone_number}
                    </div>
                  ) : null}
                </div>
                {isActive ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    Active
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    loading={settingActiveId === row.id}
                    onClick={() => onSetActive(row)}
                  >
                    Set as active
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
