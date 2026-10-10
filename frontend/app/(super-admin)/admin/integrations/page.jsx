"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import integrationsAdminService from "../../../../services/integrationsAdminService";
import useAuthStore from "../../../../store/authStore";
import { invalidateViewCache } from "../../../../lib/viewCache";
import timeAgo from "../../../../lib/timeAgo";
import {
  Badge,
  BarqRaftarWordmark,
  OmsCourierLogo,
  PostExWordmark,
  ShopifyLogo,
  SmartlaneLogo,
} from "../../../../components/integrations/IntegrationLogos";

// Same order and routes as the tenant Integrations page - managing one
// opens the store onto exactly the screen its own admin uses, so there is
// one code path that connects, edits or disconnects anything.
const INTEGRATIONS = [
  { key: "shopify", name: "Shopify", logo: ShopifyLogo, href: "/integrations/shopify" },
  { key: "smartlane", name: "Smartlane", logo: SmartlaneLogo, href: "/integrations/smartlane" },
  {
    key: "oms_courier",
    name: "OMS Courier",
    logo: OmsCourierLogo,
    href: "/integrations/oms-courier",
  },
  {
    key: "barq_raftar",
    name: "BarqRaftar",
    logo: BarqRaftarWordmark,
    wordmark: true,
    href: "/integrations/barq-raftar",
  },
  {
    key: "postex",
    name: "PostEx",
    logo: PostExWordmark,
    wordmark: true,
    href: "/integrations/postex",
  },
];

// OMS Courier requests still waiting on the platform team or on Smartlane.
const OMS_PENDING = new Set(["pending_approval", "in_review"]);

function cellState(key, entry) {
  if (!entry) return "none";
  if (entry.connected) return "connected";
  if (key === "oms_courier") {
    if (OMS_PENDING.has(entry.status)) return "pending";
    if (entry.status === "rejected") return "rejected";
  }
  return "disconnected";
}

const ATTENTION_STATES = new Set(["pending", "rejected", "disconnected"]);

const STATE_PILL = {
  connected: { text: "Connected", className: "bg-green-100 text-green-700" },
  pending: { text: "Pending", className: "bg-sky-50 text-sky-700" },
  rejected: { text: "Rejected", className: "bg-red-50 text-red-700" },
  disconnected: { text: "Disconnected", className: "bg-amber-50 text-amber-700" },
  none: { text: "Not set up", className: "bg-slate-100 text-slate-500" },
};

const STATUS_FILTERS = [
  { key: "all", label: "All stores" },
  { key: "connected", label: "Connected" },
  { key: "attention", label: "Needs attention" },
  { key: "none", label: "Not set up" },
];

function SummaryCard({ integration, stats, active, onToggle }) {
  const notes = [];
  if (stats.pending) notes.push(`${stats.pending} pending`);
  if (stats.off) notes.push(`${stats.off} not connected`);

  return (
    <div
      className={`flex flex-col rounded-xl border bg-white p-4 transition ${
        active ? "border-brand-500 ring-2 ring-brand-100" : "border-surface-border"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        title={active ? "Show every integration" : `Filter the table to ${integration.name}`}
        className="flex flex-col items-start text-left focus:outline-none"
      >
        <span className="flex items-center gap-3">
          <Badge Logo={integration.logo} wordmark={integration.wordmark} />
          <span className="text-sm font-semibold text-slate-900">{integration.name}</span>
        </span>
        <span className="mt-3 text-2xl font-semibold text-slate-900">{stats.connected}</span>
        <span className="text-xs text-slate-500">
          {stats.connected === 1 ? "store connected" : "stores connected"}
        </span>
      </button>
      <p className={`mt-2 text-xs ${notes.length ? "text-amber-700" : "text-slate-400"}`}>
        {notes.length ? notes.join(" · ") : "Nothing needs attention"}
      </p>
      {integration.key === "oms_courier" && stats.pending ? (
        <Link
          href="/admin/smartlane"
          className="mt-1 text-xs font-medium text-brand-700 hover:underline"
        >
          Review requests →
        </Link>
      ) : null}
    </div>
  );
}

function IntegrationCell({ integration, entry, disabled, highlighted, onManage }) {
  const state = cellState(integration.key, entry);
  const pill = STATE_PILL[state];
  // OMS Courier's label is its onboarding status - redundant next to a
  // "Connected" pill, useful next to any other.
  const detail =
    integration.key === "oms_courier" && state === "connected" ? "" : entry?.label || "";
  const activity = entry?.last_activity_at;
  const action = state === "none" ? "Set up" : "Manage";

  return (
    <td className={`px-3 py-3 align-top ${highlighted ? "bg-brand-50/40" : ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={onManage}
        title={
          disabled ? "Suspended stores can't be opened" : `${action} ${integration.name} for this store`
        }
        className="group flex w-full max-w-[150px] flex-col items-start gap-1 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:cursor-not-allowed"
      >
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${pill.className}`}>
          {pill.text}
        </span>
        {detail ? (
          <span className="w-full truncate text-xs text-slate-600" title={detail}>
            {detail}
          </span>
        ) : null}
        {activity ? (
          <span className="text-[11px] text-slate-400" title={new Date(activity).toLocaleString()}>
            Active {timeAgo(activity)}
          </span>
        ) : null}
        {entry?.error ? (
          <span className="w-full truncate text-[11px] text-red-600" title={entry.error}>
            {entry.error}
          </span>
        ) : null}
        {!disabled ? (
          <span className="text-[11px] font-medium text-brand-700 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            {action} →
          </span>
        ) : null}
      </button>
    </td>
  );
}

export default function AdminIntegrationsPage() {
  const router = useRouter();
  const enterStore = useAuthStore((s) => s.enterStore);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStores(await integrationsAdminService.listStoreIntegrations());
    } catch (err) {
      setError(err.message || "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const out = {};
    for (const integration of INTEGRATIONS) {
      out[integration.key] = { connected: 0, pending: 0, off: 0 };
    }
    for (const store of stores) {
      for (const integration of INTEGRATIONS) {
        const state = cellState(integration.key, store.integrations?.[integration.key]);
        if (state === "connected") out[integration.key].connected += 1;
        else if (state === "pending") out[integration.key].pending += 1;
        else if (state !== "none") out[integration.key].off += 1;
      }
    }
    return out;
  }, [stores]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    // The status filter looks at the selected integration's cell only, or
    // at all five when none is selected.
    const scope = selected ? INTEGRATIONS.filter((i) => i.key === selected) : INTEGRATIONS;
    return stores.filter((store) => {
      if (q && !store.name?.toLowerCase().includes(q) && !store.slug?.toLowerCase().includes(q)) {
        return false;
      }
      const states = scope.map((i) => cellState(i.key, store.integrations?.[i.key]));
      if (statusFilter === "connected") return states.includes("connected");
      if (statusFilter === "attention") return states.some((s) => ATTENTION_STATES.has(s));
      if (statusFilter === "none") return states.every((s) => s === "none");
      return true;
    });
  }, [stores, search, statusFilter, selected]);

  function openStore(store, href) {
    enterStore({
      id: store.id,
      name: store.name,
      modules: store.modules || [],
      is_manual_store: store.is_manual_store,
    });
    invalidateViewCache();
    router.push(href);
  }

  const selectedName = INTEGRATIONS.find((i) => i.key === selected)?.name;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every store&apos;s connections in one place. Click any cell to open that store straight
          onto the integration, on the same screen its own admin uses.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {INTEGRATIONS.map((integration) => (
          <SummaryCard
            key={integration.key}
            integration={integration}
            stats={stats[integration.key]}
            active={selected === integration.key}
            onToggle={() =>
              setSelected((current) => (current === integration.key ? "" : integration.key))
            }
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                statusFilter === f.key
                  ? "bg-brand-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.label}
            </button>
          ))}
          {selectedName ? (
            <button
              type="button"
              onClick={() => setSelected("")}
              className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
            >
              {selectedName} only ✕
            </button>
          ) : null}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stores…"
          className="w-64 max-w-full rounded-lg border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-surface-border bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-sm text-slate-500">Loading integrations…</p>
        ) : visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            {stores.length === 0 ? "No stores yet." : "No stores match these filters."}
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b border-surface-border bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Store</th>
                {INTEGRATIONS.map((integration) => (
                  <th
                    key={integration.key}
                    className={`whitespace-nowrap px-3 py-3 ${
                      selected === integration.key ? "bg-brand-50 text-brand-700" : ""
                    }`}
                  >
                    {integration.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {visible.map((store) => (
                <tr key={store.id}>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-slate-900">{store.name}</p>
                    {store.is_active ? (
                      <button
                        type="button"
                        onClick={() => openStore(store, "/integrations")}
                        className="mt-1 text-xs font-medium text-brand-700 hover:underline"
                      >
                        Open integrations →
                      </button>
                    ) : (
                      <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                        Suspended
                      </span>
                    )}
                  </td>
                  {INTEGRATIONS.map((integration) => (
                    <IntegrationCell
                      key={integration.key}
                      integration={integration}
                      entry={store.integrations?.[integration.key]}
                      disabled={!store.is_active}
                      highlighted={selected === integration.key}
                      onManage={() => openStore(store, integration.href)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && stores.length ? (
        <p className="text-xs text-slate-400">
          Showing {visible.length} of {stores.length} stores
        </p>
      ) : null}
    </div>
  );
}
