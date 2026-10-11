"use client";

import { useEffect, useState } from "react";
import integrationsService from "../../../../../services/integrationsService";

export const EMPTY_BARQRAFTAR_FORM = {
  name: "",
  city_id: "",
  city_name: "",
  address: "",
  person_of_contact: "",
  phone_number: "",
  latitude: "",
  longitude: "",
};

const ADDRESS_MAX = 500;

const inputClass =
  "mt-1 w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500";

function Field({ label, required, hint, wide, children }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {required ? <span className="text-red-500"> *</span> : null}
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-slate-400">{hint}</span> : null}
    </label>
  );
}

// BarqRaftar's own pickup-address form - the fields of its
// company_addresses/store API. When FynkTech approves the request it becomes
// a pickup address on FynkTech's BarqRaftar account, named after the store,
// and BarqRaftar gives it the id every booking of this store's orders then
// picks up from (backend integrations/oms_courier_service.py). The caller
// renders the submit button (form={formId}) and saves `onSubmit`'s values.
export default function BarqRaftarAddressForm({ formId, initial, pickupAddressId, onSubmit }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_BARQRAFTAR_FORM, ...(initial || {}) }));
  const [cities, setCities] = useState([]);
  const [citiesError, setCitiesError] = useState("");

  useEffect(() => {
    let cancelled = false;
    integrationsService
      .getOmsCourierCourierOptions("barq_raftar")
      .then((data) => {
        if (!cancelled) setCities(data.cities || []);
      })
      .catch((err) => {
        if (!cancelled) setCitiesError(err.message || "Could not load BarqRaftar's cities");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function pickCity(id) {
    const city = cities.find((c) => c.id === id);
    setForm((prev) => ({ ...prev, city_id: id, city_name: city ? city.name : "" }));
  }

  // A saved city BarqRaftar no longer lists stays visible instead of vanishing.
  const options =
    form.city_id && !cities.some((c) => c.id === form.city_id)
      ? [{ id: form.city_id, name: form.city_name || form.city_id }, ...cities]
      : cities;

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      {citiesError ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {citiesError} - try again in a moment.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store Name" required hint="The pickup address is saved under this name.">
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Store Name"
            maxLength={255}
            required
            className={inputClass}
          />
        </Field>
        <Field label="City" required>
          <select
            value={form.city_id}
            onChange={(e) => pickCity(e.target.value)}
            required
            className={inputClass}
          >
            <option value="" disabled>
              {options.length ? "Select a city…" : "Loading cities…"}
            </option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Person of Contact" required>
          <input
            type="text"
            value={form.person_of_contact}
            onChange={(e) => set("person_of_contact", e.target.value)}
            placeholder="Person of Contact"
            maxLength={255}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Phone Number" required>
          <input
            type="tel"
            value={form.phone_number}
            onChange={(e) => set("phone_number", e.target.value)}
            placeholder="03xxxxxxxxx"
            maxLength={16}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Latitude" hint="Optional - helps the rider find you.">
          <input
            type="text"
            inputMode="decimal"
            value={form.latitude}
            onChange={(e) => set("latitude", e.target.value)}
            placeholder="31.5204"
            maxLength={20}
            className={inputClass}
          />
        </Field>
        <Field label="Longitude" hint="Optional.">
          <input
            type="text"
            inputMode="decimal"
            value={form.longitude}
            onChange={(e) => set("longitude", e.target.value)}
            placeholder="74.3587"
            maxLength={20}
            className={inputClass}
          />
        </Field>
        <Field label="Pickup Address ID" hint="BarqRaftar gives the id once FynkTech approves the request.">
          <input
            type="text"
            value={pickupAddressId || ""}
            placeholder="Given by BarqRaftar"
            disabled
            className={inputClass}
          />
        </Field>
        <Field label="Address" required wide>
          <textarea
            value={form.address}
            onChange={(e) => set("address", e.target.value.slice(0, ADDRESS_MAX))}
            rows={3}
            placeholder="Address"
            required
            className={inputClass}
          />
          <span className="mt-1 block text-right text-xs font-normal text-slate-400">
            {form.address.length}/{ADDRESS_MAX}
          </span>
        </Field>
      </div>
    </form>
  );
}
