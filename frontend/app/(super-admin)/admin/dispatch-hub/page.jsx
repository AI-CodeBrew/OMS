"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dispatchHubAdminService from "../../../../services/dispatchHubAdminService";
import tenantsService from "../../../../services/tenantsService";
import useAuthStore from "../../../../store/authStore";
import { invalidateViewCache } from "../../../../lib/viewCache";
import Button from "../../../../components/shared/Button";

export default function DispatchHubPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);

  const [hubStores, setHubStores] = useState([]);
  const [allStores, setAllStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [addingOrgId, setAddingOrgId] = useState("");
  const [addingRate, setAddingRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [rateEdits, setRateEdits] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [hub, orgs] = await Promise.all([
        dispatchHubAdminService.listStores(),
        tenantsService.listOrganizations(),
      ]);
      setHubStores(hub);
      setAllStores(orgs.organizations || []);
    } catch (err) {
      setError(err.message || "Failed to load the Dispatch Hub");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const candidates = useMemo(
    () => allStores.filter((org) => !org.in_dispatch_hub && org.is_active),
    [allStores]
  );

  async function onAdd(e) {
    e.preventDefault();
    if (!addingOrgId) return;
    setSaving(true);
    setError("");
    try {
      setHubStores(await dispatchHubAdminService.addStore(addingOrgId, addingRate || 0));
      setAddingOrgId("");
      setAddingRate("");
      await load();
    } catch (err) {
      setError(err.message || "Could not add the store");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveRate(orgId) {
    setSaving(true);
    setError("");
    try {
      setHubStores(await dispatchHubAdminService.updateRate(orgId, rateEdits[orgId] ?? 0));
    } catch (err) {
      setError(err.message || "Could not update the rate");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(orgId, name) {
    if (!window.confirm(`Remove "${name}" from the Dispatch Hub?`)) return;
    setError("");
    try {
      setHubStores(await dispatchHubAdminService.removeStore(orgId));
    } catch (err) {
      setError(err.message || "Could not remove the store");
    }
  }

  function openHub() {
    enterStore({ hub: true, name: "Dispatch Hub", modules: ["oms", "wms"], storeCount: hubStores.length });
    invalidateViewCache();
    router.push("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dispatch Hub</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pick the stores FynkTech dispatches for, then operate all their orders together -
            confirm, assign couriers, print, returns - exactly like one admin screen.
          </p>
        </div>
        <Button type="button" disabled={!hubStores.length} onClick={openHub}>
          Open Dispatch Hub →
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <form
        onSubmit={onAdd}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-surface-border bg-white p-5"
      >
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Store</span>
          <select
            value={addingOrgId}
            onChange={(e) => setAddingOrgId(e.target.value)}
            className="min-w-[14rem] rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Select a store…</option>
            {candidates.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Rate per order (Rs)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={addingRate}
            onChange={(e) => setAddingRate(e.target.value)}
            className="w-36 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <Button type="submit" disabled={!addingOrgId} loading={saving}>
          Add to Hub
        </Button>
      </form>

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-sm text-slate-500">Loading…</p>
        ) : hubStores.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            No stores in the Dispatch Hub yet - add one above.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {hubStores.map((store) => (
              <li key={store.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{store.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    {!store.is_active ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                        Suspended
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        store.oms_courier_connected
                          ? "bg-sky-50 text-sky-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {store.oms_courier_connected ? "OMS Courier connected" : "OMS Courier not set up"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        store.bank_details ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {store.bank_details ? `Bank: ${store.bank_details.bank_name}` : "No bank details"}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={store.per_order_rate}
                    onChange={(e) =>
                      setRateEdits((m) => ({ ...m, [store.id]: e.target.value }))
                    }
                    className="w-28 rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    loading={saving}
                    onClick={() => onSaveRate(store.id)}
                  >
                    Save rate
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => onRemove(store.id, store.name)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
