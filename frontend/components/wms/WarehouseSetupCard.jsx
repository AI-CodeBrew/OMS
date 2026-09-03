"use client";

import { useState } from "react";
import wmsService from "../../services/wmsService";
import Button from "../shared/Button";

/**
 * First-run state for the WMS module. Stock control stays inert until a
 * warehouse exists (see wms.services.get_default_warehouse), so rather
 * than showing an empty table this explains why and gets the user to the
 * one thing they need to do.
 */
export default function WarehouseSetupCard({ onCreated }) {
  const [name, setName] = useState("Main Warehouse");
  const [code, setCode] = useState("MAIN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await wmsService.createWarehouse({ code: code.trim(), name: name.trim(), is_default: true });
      await onCreated?.();
    } catch (err) {
      setError(err.message || "Failed to create warehouse");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 max-w-lg rounded-lg border border-surface-border bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">Set up your warehouse</h2>
      <p className="mt-1 text-sm text-slate-500">
        Inventory tracking starts once you have a warehouse. Until then, orders process normally
        without any stock checks.
      </p>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Warehouse Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Warehouse Code</span>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Short identifier used on documents. If you use Smartlane, matching their warehouse code
            keeps both systems aligned.
          </span>
        </label>
        <Button type="submit" loading={saving} className="w-full justify-center">
          Create Warehouse
        </Button>
      </form>
    </div>
  );
}
