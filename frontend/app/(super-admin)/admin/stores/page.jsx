"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import tenantsService from "../../../../services/tenantsService";
import dispatchHubAdminService from "../../../../services/dispatchHubAdminService";
import useAuthStore from "../../../../store/authStore";
import { invalidateViewCache } from "../../../../lib/viewCache";
import GreenTick from "../../../../components/shared/GreenTick";
import Modal from "../../../../components/shared/Modal";
import Button from "../../../../components/shared/Button";

import { formatDateTime } from "../../../../lib/formatDate";
// What FynkTech does for the store - core.Organization.SERVICE_MODEL_CHOICES.
const SERVICE_MODELS = [
  { value: "all_in_one", label: "All in One", hint: "Dispatching, fulfilment and delivery with OMS couriers" },
  { value: "fulfilment", label: "Only Fulfilment", hint: "We dispatch; the store's own courier delivers" },
  { value: "courier", label: "Only Courier", hint: "OMS couriers connected; the store dispatches itself" },
  { value: "oms_only", label: "Just OMS", hint: "OMS for visibility only" },
];

function formatDate(value) {
  return value ? formatDateTime(value) : "";
}

// One bordered card per section, each field its own bordered box - label
// on top, value below; `wide` fields take the full row.
function DetailsSection({ title, rows }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {rows.map(([label, value, wide]) => (
          <div
            key={label}
            className={`rounded-lg border border-slate-200 px-3 py-2.5 ${wide ? "sm:col-span-2" : ""}`}
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 select-all break-words text-sm font-semibold text-slate-900">
              {value || <span className="font-normal text-slate-400">—</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Opened from the Bank column: the store's profile - organization, its
// IDs, login email, service model, when it connected - and its bank
// details (finance.BankDetails, where FynkTech remits its COD). The list
// carries no emails, so the store's own record is loaded for them.
function StoreDetailsPopup({ org, onClose }) {
  const [emails, setEmails] = useState(null);

  useEffect(() => {
    if (!org) return undefined;
    let cancelled = false;
    setEmails(null);
    tenantsService
      .getOrganization(org.id)
      .then((data) => {
        if (cancelled) return;
        const members = data.organization?.members || [];
        // The admin login first.
        const sorted = [...members].sort((a, b) => Number(b.role === "org_admin") - Number(a.role === "org_admin"));
        setEmails(sorted.map((m) => m.email).filter(Boolean));
      })
      .catch(() => !cancelled && setEmails([]));
    return () => {
      cancelled = true;
    };
  }, [org]);

  if (!org) return null;
  const bank = org.bank_details || {};
  const stores = org.stores || [];
  const service = SERVICE_MODELS.find((m) => m.value === org.service_model);
  const connected = org.shopify?.connected_at;

  return (
    <Modal
      open
      title={org.name}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        <DetailsSection
          title="Store"
          rows={[
            ["Organization", org.name],
            ["Organization ID", org.store_code != null ? String(org.store_code) : ""],
            ["Store IDs", stores.map((st) => `${st.store_id} - ${st.name}`).join(", ")],
            ["Email", emails === null ? "Loading…" : emails.join(", "), true],
            ["Services", service ? `${service.label} - ${service.hint}` : "Not Set", true],
            [
              "Date Connected",
              connected ? `${formatDate(connected)} (Shopify)` : `${formatDate(org.created_at)} (store created)`,
            ],
          ]}
        />
        <DetailsSection
          title="Bank"
          rows={[
            ["Bank Name", bank.bank_name],
            ["Account Title", bank.account_title],
            ["Account Number", bank.account_number],
            ["IBAN", bank.iban, true],
            ["Branch Code", bank.branch_code],
            ["Last Updated", formatDate(bank.updated_at)],
          ]}
        />
      </div>
    </Modal>
  );
}

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
  const [hubBusyId, setHubBusyId] = useState("");
  const [modelBusyId, setModelBusyId] = useState("");
  const [bankOrg, setBankOrg] = useState(null);

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
    const filtered = q
      ? stores.filter(
          (s) =>
            s.name?.toLowerCase().includes(q) ||
            s.slug?.toLowerCase().includes(q) ||
            s.shopify?.shop_domain?.toLowerCase().includes(q)
        )
      : stores;
    // Dispatch Hub stores float to the top (green tick), same convention
    // as the store switcher's current-store tick.
    return [...filtered].sort((a, b) => Number(b.in_dispatch_hub) - Number(a.in_dispatch_hub));
  }, [stores, search]);

  async function toggleHub(org) {
    setHubBusyId(org.id);
    setError("");
    try {
      if (org.in_dispatch_hub) {
        await dispatchHubAdminService.removeStore(org.id);
      } else {
        await dispatchHubAdminService.addStore(org.id, 0);
      }
      await load();
    } catch (err) {
      setError(err.message || "Could not update the Dispatch Hub");
    } finally {
      setHubBusyId("");
    }
  }

  async function changeServiceModel(org, value) {
    setModelBusyId(org.id);
    setError("");
    try {
      await tenantsService.setServiceModel(org.id, value);
      setStores((list) => list.map((s) => (s.id === org.id ? { ...s, service_model: value } : s)));
    } catch (err) {
      setError(err.message || "Could not save the service model");
    } finally {
      setModelBusyId("");
    }
  }

  function openStore(org) {
    const modules = enabledModules(org);
    enterStore({ id: org.id, name: org.name, modules, is_manual_store: org.is_manual_store });
    invalidateViewCache();
    router.push(modules.includes("oms") || modules.length === 0 ? "/orders" : "/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Stores</h1>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Store Name</th>
                  <th className="px-4 py-3">Store ID</th>
                  <th className="px-4 py-3">Store Integration</th>
                  <th className="px-4 py-3">Service Model</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                  <th className="px-4 py-3">Bank</th>
                  <th className="px-5 py-3 text-right">Store</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {visible.map((org) => {
                  const shopify = org.shopify;
                  const integrated = Boolean(shopify) && !org.is_manual_store;
                  const stores = org.stores || [];
                  return (
                    <tr
                      key={org.id}
                      onClick={() => setBankOrg(org)}
                      title="Click To See Details"
                      className="cursor-pointer transition hover:bg-brand-50/40"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {org.in_dispatch_hub ? <GreenTick /> : <span className="h-4 w-4 shrink-0" />}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{org.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {stores.length ? (
                          <span title={stores.map((st) => `${st.store_id} - ${st.name}`).join(", ")}>
                            {stores.map((st) => st.store_id).join(", ")}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            integrated ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {integrated ? "Shopify Integrated" : "Manual"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={org.service_model || ""}
                          disabled={modelBusyId === org.id}
                          onChange={(e) => changeServiceModel(org, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          title={SERVICE_MODELS.find((m) => m.value === org.service_model)?.hint || ""}
                          className={`rounded-md border px-2 py-1.5 text-sm outline-none focus:border-brand-500 disabled:opacity-50 ${
                            org.service_model
                              ? "border-surface-border text-slate-800"
                              : "border-amber-300 bg-amber-50 text-amber-800"
                          }`}
                        >
                          <option value="">Not Set</option>
                          {SERVICE_MODELS.map((m) => (
                            <option key={m.value} value={m.value} title={m.hint}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {shopify ? (
                          <span
                            className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              shopify.is_connected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                            }`}
                          >
                            {shopify.is_connected ? "Shopify Connected" : "Shopify Disconnected"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">No Shopify</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          disabled={hubBusyId === org.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleHub(org);
                          }}
                          title={org.in_dispatch_hub ? "Remove from the Dispatch Hub" : "Add to the Dispatch Hub"}
                          className={`w-36 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                            org.in_dispatch_hub
                              ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
                              : "border-brand-200 bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          {org.in_dispatch_hub ? "Remove from Hub" : "Add to Hub"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {org.bank_details ? (
                          <span className="whitespace-nowrap font-medium text-brand-700">
                            {org.bank_details.bank_name}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-xs text-slate-400">Not Added</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          disabled={!org.is_active}
                          onClick={(e) => {
                            e.stopPropagation();
                            openStore(org);
                          }}
                          title={org.is_active ? "Open this store" : "Suspended stores can't be opened"}
                          className="whitespace-nowrap rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:bg-slate-300"
                        >
                          Open Store
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <StoreDetailsPopup org={bankOrg} onClose={() => setBankOrg(null)} />
    </div>
  );
}
