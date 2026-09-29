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
};

// BarqRaftar's own response shape for a pickup address isn't confirmed
// against a real response (see _lib/barqraftarService.js's module note),
// so every field read here tries a couple of plausible spellings.
function addressId(row) {
  return row.id ?? row.pickup_address_id ?? row.address_id;
}

export default function PickupAddressesTab({ status, onChanged, onError, onNotice }) {
  const [addresses, setAddresses] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState(null);

  async function load() {
    setLoading(true);
    onError("");
    try {
      const data = await barqraftarService.getPickupAddresses();
      const list = Array.isArray(data) ? data : data.addresses || data.data || [];
      setAddresses(list);
    } catch (err) {
      onError(err.message || "Failed to load pickup addresses");
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    onError("");
    try {
      await barqraftarService.savePickupAddress(form);
      onNotice("Pickup address saved.");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      onError(err.message || "Failed to save pickup address");
    } finally {
      setSaving(false);
    }
  }

  async function onSetDefault(row) {
    const id = addressId(row);
    setSettingDefaultId(id);
    onError("");
    try {
      await barqraftarService.updateSettings({
        pickup_address_id: String(id),
        pickup_address_label: row.name || row.address || "",
      });
      onNotice("Default pickup address updated.");
      onChanged();
    } catch (err) {
      onError(err.message || "Failed to set default pickup address");
    } finally {
      setSettingDefaultId(null);
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
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">City ID</span>
              <input
                required
                value={form.city_id}
                onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value }))}
                placeholder="From the Cities tab"
                className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
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
            const id = addressId(row);
            const isDefault = String(id) === String(status.pickup_address_id);
            return (
              <li key={id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">{row.name || `Address #${id}`}</div>
                  <div className="text-xs text-slate-500">{row.address}</div>
                </div>
                {isDefault ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    Default
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    loading={settingDefaultId === id}
                    onClick={() => onSetDefault(row)}
                  >
                    Set as default
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
