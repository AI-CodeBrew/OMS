"use client";

import { useEffect, useState } from "react";
import Button from "../../../../../components/shared/Button";
import postexService from "../_lib/postexService";

const EMPTY_FORM = {
  address: "",
  city_name: "",
  contact_person_name: "",
  phone1: "",
  phone2: "",
  warehouse_manager_name: "",
  set_default: true,
};

const INPUT =
  "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

// Real PostEx address shape (confirmed live): merchantAddressId, address,
// phone1/2/3, wareHouseManagerName, contactPersonName, cityName,
// addressCode ("001"), addressType ("Default Address" | "Pickup/Return
// Address" | "Return Address"). Only pickup-capable ones can be active.
function canPickUp(row) {
  const type = String(row.addressType || "").toLowerCase();
  return !type || type.includes("pickup") || type.includes("default");
}

export default function PickupAddressesTab({ status, onChanged, onError, onNotice }) {
  const [addresses, setAddresses] = useState(null);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingCode, setSettingCode] = useState(null);

  async function load() {
    setLoading(true);
    onError("");
    try {
      const data = await postexService.getPickupAddresses();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadCitiesOnce() {
    if (cities.length) return;
    postexService
      .getCities()
      .then((data) => setCities(data.cities || []))
      .catch(() => {});
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!window.confirm("Add this pickup address to your PostEx account?")) return;
    setSaving(true);
    onError("");
    try {
      const data = await postexService.addPickupAddress(form);
      setAddresses(data.addresses || []);
      onNotice(form.set_default ? "Pickup address added and set as active." : "Pickup address added.");
      setForm(EMPTY_FORM);
      setShowForm(false);
      if (form.set_default) onChanged();
    } catch (err) {
      onError(err.message || "Failed to add pickup address");
    } finally {
      setSaving(false);
    }
  }

  async function onSetActive(row) {
    const label = row.contactPersonName || row.address;
    if (!window.confirm(`Make "${label}" (code ${row.addressCode}) the active pickup address?`)) return;
    setSettingCode(row.addressCode);
    onError("");
    try {
      await postexService.updateSettings({
        pickup_address_code: String(row.addressCode),
        pickup_address_label: row.contactPersonName || row.address || "",
        pickup_city_name: row.cityName || "",
      });
      onNotice("Active pickup address updated - new bookings are collected from here.");
      onChanged();
    } catch (err) {
      onError(err.message || "Failed to set active pickup address");
    } finally {
      setSettingCode(null);
    }
  }

  return (
    <div className="rounded-lg border border-surface-border bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Pickup Addresses</h3>
        <Button
          variant="secondary"
          onClick={() => {
            setShowForm((s) => !s);
            loadCitiesOnce();
          }}
        >
          {showForm ? "Cancel" : "Add Address"}
        </Button>
      </div>

      {showForm ? (
        <form onSubmit={onSubmit} className="mb-4 space-y-3 rounded-md border border-surface-border p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Address</span>
            <input
              required
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className={INPUT}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">City</span>
              <input
                required
                list="postex-city-options"
                value={form.city_name}
                onChange={(e) => setForm((f) => ({ ...f, city_name: e.target.value }))}
                placeholder="Start typing…"
                className={INPUT}
              />
              <datalist id="postex-city-options">
                {cities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Contact person / store name</span>
              <input
                required
                value={form.contact_person_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_person_name: e.target.value }))}
                className={INPUT}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Phone</span>
              <input
                required
                value={form.phone1}
                onChange={(e) => setForm((f) => ({ ...f, phone1: e.target.value }))}
                placeholder="03001234567"
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Second phone</span>
              <input
                value={form.phone2}
                onChange={(e) => setForm((f) => ({ ...f, phone2: e.target.value }))}
                placeholder="Optional"
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Warehouse manager</span>
              <input
                value={form.warehouse_manager_name}
                onChange={(e) => setForm((f) => ({ ...f, warehouse_manager_name: e.target.value }))}
                placeholder="Optional"
                className={INPUT}
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
        <p className="text-sm text-slate-500">No addresses on your PostEx account yet - add one above.</p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {addresses.map((row) => {
            const isActive = String(row.addressCode) === String(status.pickup_address_code);
            return (
              <li key={row.merchantAddressId || row.addressCode} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    {row.contactPersonName || "Address"}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      code {row.addressCode} · {row.addressType}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.address}
                    {row.cityName ? ` - ${row.cityName}` : ""}
                  </div>
                  {row.wareHouseManagerName || row.phone1 ? (
                    <div className="text-xs text-slate-400">
                      {row.wareHouseManagerName} {row.phone1}
                    </div>
                  ) : null}
                </div>
                {isActive ? (
                  <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    Active
                  </span>
                ) : canPickUp(row) ? (
                  <Button
                    variant="secondary"
                    loading={settingCode === row.addressCode}
                    onClick={() => onSetActive(row)}
                  >
                    Set as active
                  </Button>
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">Returns only</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
