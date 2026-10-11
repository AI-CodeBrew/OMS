"use client";

import { useEffect, useState } from "react";
import integrationsService from "../../../../../services/integrationsService";

export const EMPTY_POSTEX_FORM = {
  city: "",
  address_type: "",
  shipper_name: "",
  shipper_contact: "",
  contact_person_name: "",
  contact_1: "",
  contact_2: "",
  address: "",
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

// PostEx's own "Add Address" form, field for field. When FynkTech approves
// the request it becomes a pickup address on FynkTech's PostEx account, and
// PostEx gives it the address code every booking of this store's orders
// then goes out from (backend integrations/oms_courier_service.py). What's
// required is what PostEx's create-merchant-address requires: the contact
// person and their first number; the shipper (PostEx's warehouse manager)
// is optional. Cities are the ones PostEx picks up from. The caller renders
// the submit button (form={formId}) and saves `onSubmit`'s values.
export default function PostExAddressForm({ formId, initial, addressCode, onSubmit }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_POSTEX_FORM, ...(initial || {}) }));
  const [options, setOptions] = useState({ cities: [], address_types: [] });
  const [optionsError, setOptionsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    integrationsService
      .getOmsCourierCourierOptions("postex")
      .then((data) => {
        if (!cancelled) setOptions({ cities: data.cities || [], address_types: data.address_types || [] });
      })
      .catch((err) => {
        if (!cancelled) setOptionsError(err.message || "Could not load PostEx's cities");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // A saved city PostEx no longer lists stays visible instead of vanishing.
  const cities =
    form.city && !options.cities.includes(form.city) ? [form.city, ...options.cities] : options.cities;

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      {optionsError ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {optionsError} - type the city exactly as PostEx spells it.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Select City" required>
          {cities.length ? (
            <select
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              required
              className={inputClass}
            >
              <option value="" disabled>
                Select a city…
              </option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder={optionsError ? "e.g. LAHORE" : "Loading pickup cities…"}
              required
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Address Type" required hint="Orders are picked up from here - Pickup or Pickup/Return.">
          <select
            value={form.address_type}
            onChange={(e) => set("address_type", e.target.value)}
            required
            className={inputClass}
          >
            <option value="">Select</option>
            {(options.address_types.length
              ? options.address_types
              : [
                  { value: "return", label: "Return Address" },
                  { value: "pickup", label: "Pickup Address" },
                  { value: "pickup_return", label: "Pickup/Return Address" },
                ]
            ).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Address Code" hint="PostEx gives the code once FynkTech approves the request.">
          <input
            type="text"
            value={addressCode || ""}
            placeholder="Given by PostEx"
            disabled
            className={inputClass}
          />
        </Field>
        <Field label="Shipper Name">
          <input
            type="text"
            value={form.shipper_name}
            onChange={(e) => set("shipper_name", e.target.value)}
            placeholder="Shipper Name"
            maxLength={255}
            className={inputClass}
          />
        </Field>
        <Field label="Shipper Contact">
          <input
            type="tel"
            value={form.shipper_contact}
            onChange={(e) => set("shipper_contact", e.target.value)}
            placeholder="03xxxxxxxxx"
            maxLength={16}
            className={inputClass}
          />
        </Field>
        <Field label="Contact Person Name" required>
          <input
            type="text"
            value={form.contact_person_name}
            onChange={(e) => set("contact_person_name", e.target.value)}
            placeholder="Contact Person Name"
            maxLength={255}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Contact#1" required>
          <input
            type="tel"
            value={form.contact_1}
            onChange={(e) => set("contact_1", e.target.value)}
            placeholder="03xxxxxxxxx"
            maxLength={16}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Contact#2">
          <input
            type="tel"
            value={form.contact_2}
            onChange={(e) => set("contact_2", e.target.value)}
            placeholder="03xxxxxxxxx"
            maxLength={16}
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
