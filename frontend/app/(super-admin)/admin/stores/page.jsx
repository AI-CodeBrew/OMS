"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import tenantsService from "../../../../services/tenantsService";
import useAuthStore from "../../../../store/authStore";
import { invalidateViewCache } from "../../../../lib/viewCache";

function enabledModules(org) {
  return (org.modules || []).filter((m) => m.is_enabled).map((m) => m.module);
}

export default function StoresPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await tenantsService.listOrganizations();
      setStores(data.organizations || []);
    } catch (err) {
      setError(err.message || "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.slug?.toLowerCase().includes(q) ||
        s.shopify?.shop_domain?.toLowerCase().includes(q)
    );
  }, [stores, search]);

  function openStore(org) {
    const modules = enabledModules(org);
    enterStore({ id: org.id, name: org.name, modules });
    invalidateViewCache();
    router.push(modules.includes("oms") || modules.length === 0 ? "/orders" : "/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Stores</h1>
          <p className="mt-1 text-sm text-slate-500">
            Open a store to operate it exactly like its own admin — orders, airway bills, load
            sheets, warehouse and more.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stores…"
          className="w-64 max-w-full rounded-lg border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-sm text-slate-500">Loading stores…</p>
        ) : visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            {stores.length === 0 ? "No stores connected yet." : "No stores match your search."}
          </p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {visible.map((org) => {
              const modules = enabledModules(org);
              const shopify = org.shopify;
              return (
                <li
                  key={org.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{org.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {org.plan}
                      {modules.length ? ` · ${modules.join(", ")}` : ""}
                      {shopify?.shop_domain ? ` · ${shopify.shop_domain}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {shopify ? (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          shopify.is_connected
                            ? "bg-sky-50 text-sky-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {shopify.is_connected ? "Shopify connected" : "Shopify disconnected"}
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        org.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {org.is_active ? "Active" : "Suspended"}
                    </span>
                    <button
                      type="button"
                      disabled={!org.is_active}
                      onClick={() => openStore(org)}
                      title={org.is_active ? undefined : "Suspended stores can't be opened"}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Open store →
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
