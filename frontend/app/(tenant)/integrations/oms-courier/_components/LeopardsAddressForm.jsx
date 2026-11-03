"use client";

import { useEffect, useState } from "react";
import integrationsService from "../../../../../services/integrationsService";

export const EMPTY_LEOPARDS_FORM = {
  name: "",
  email: "",
  phone: "",
  city_id: "",
  city_name: "",
  address: "",
  return_address: "",
  cnic: "",
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

// Leopards' shipper form - the fields of its createShipper API. When FynkTech
// approves the request it becomes a shipper on FynkTech's Leopards account,
// named after the store, and Leopards gives it the shipper id every booking
// of this store's orders then goes out under (backend integrations/
// oms_courier_service.py). The caller renders the submit button
// (form={formId}) and saves `onSubmit`'s values.
export default function LeopardsAddressForm({ formId, initial, pickupAddressId, onSubmit }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_LEOPARDS_FORM, ...(initial || {}) }));
  const [cities, setCities] = useState([]);
  const [citiesError, setCitiesError] = useState("");

  useEffect(() => {
    let cancelled = false;
    integrationsService
      .getOmsCourierCourierOptions("leopards")
      .then((data) => {
        if (!cancelled) setCities(data.cities || []);
      })
      .catch((err) => {
        if (!cancelled) setCitiesError(err.message || "Could not load Leopards' cities");
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

  // A saved city Leopards no longer lists stays visible instead of vanishing.
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
        <Field label="Shipper Name" required hint="The shipper is saved under this name.">
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
        <Field label="City" required hint="The city your parcels are collected from.">
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
        <Field label="Phone Number" required>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="03xxxxxxxxx"
            maxLength={16}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Email" hint="Optional.">
          <input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="store@example.com"
            maxLength={255}
            className={inputClass}
          />
        </Field>
        <Field label="CNIC" hint="Optional.">
          <input
            type="text"
            value={form.cnic}
            onChange={(e) => set("cnic", e.target.value)}
            placeholder="xxxxx-xxxxxxx-x"
            maxLength={15}
            className={inputClass}
          />
        </Field>
        <Field label="Shipper ID" hint="Leopards gives the id once FynkTech approves the request.">
          <input
            type="text"
            value={pickupAddressId || ""}
            placeholder="Given by Leopards"
            disabled
            className={inputClass}
          />
        </Field>
        <Field label="Address" required wide>
          <textarea
            value={form.address}
            onChange={(e) => set("address", e.target.value.slice(0, ADDRESS_MAX))}
            rows={3}
            placeholder="Pickup address"
            required
            className={inputClass}
          />
          <span className="mt-1 block text-right text-xs font-normal text-slate-400">
            {form.address.length}/{ADDRESS_MAX}
          </span>
        </Field>
        <Field label="Return Address" wide hint="Optional - where returned parcels go. Defaults to the address above.">
          <textarea
            value={form.return_address}
            onChange={(e) => set("return_address", e.target.value.slice(0, ADDRESS_MAX))}
            rows={2}
            placeholder="Return address"
            className={inputClass}
          />
        </Field>
      </div>
    </form>
  );
}
