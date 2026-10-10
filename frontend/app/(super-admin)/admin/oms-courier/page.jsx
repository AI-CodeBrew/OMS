"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import integrationsAdminService from "../../../../services/integrationsAdminService";
import timeAgo from "../../../../lib/timeAgo";
import {
  Badge,
  BarqRaftarWordmark,
  OmsCourierLogo,
  PostExWordmark,
  SmartlaneLogo,
} from "../../../../components/integrations/IntegrationLogos";

// FynkTech's own courier accounts. Each opens the same page a store admin
// uses for that integration, acting as the platform org - see
// (accounts)/layout.jsx.
const ACCOUNTS = [
  {
    key: "barq_raftar",
    name: "BarqRaftar",
    tagline: "FynkTech's BarqRaftar account - pickup addresses, cities, shipments and payments.",
    logo: BarqRaftarWordmark,
    wordmark: true,
    href: "/admin/oms-courier/barq-raftar",
  },
  {
    key: "postex",
    name: "PostEx",
    tagline: "FynkTech's PostEx merchant account - pickup addresses, cities and shipments.",
    logo: PostExWordmark,
    wordmark: true,
    href: "/admin/oms-courier/postex",
  },
  {
    key: "smartlane",
    name: "Smartlane",
    tagline: "FynkTech's own Smartlane account, connected with its API key and warehouse code.",
    logo: SmartlaneLogo,
    href: "/admin/oms-courier/smartlane",
  },
];

function StatusPill({ connected, children }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        connected ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {children}
    </span>
  );
}

function AccountCard({ account, entry }) {
  const connected = Boolean(entry?.connected);
  const activity = entry?.last_activity_at;

  return (
    <div className="flex flex-col rounded-xl border border-surface-border bg-white p-5">
      <div className="flex items-center justify-between">
        <Badge Logo={account.logo} wordmark={account.wordmark} />
        <StatusPill connected={connected}>
          {connected ? "Connected" : entry ? "Disconnected" : "Not connected"}
        </StatusPill>
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900">{account.name}</h3>
      <p className="mt-1 flex-1 text-sm text-slate-500">{account.tagline}</p>
      {entry?.label || activity || entry?.error ? (
        <div className="mt-3 space-y-0.5 text-xs">
          {entry?.label ? <p className="truncate text-slate-600">{entry.label}</p> : null}
          {activity ? (
            <p className="text-slate-400" title={new Date(activity).toLocaleString()}>
              Active {timeAgo(activity)}
            </p>
          ) : null}
          {entry?.error ? <p className="truncate text-red-600">{entry.error}</p> : null}
        </div>
      ) : null}
      <Link
        href={account.href}
        className="mt-5 inline-flex items-center justify-center rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
      >
        {connected ? `Manage ${account.name}` : `Connect ${account.name}`}
      </Link>
    </div>
  );
}

function SmartlaneBusinessCard({ business }) {
  const pending = business?.pending_requests || 0;
  return (
    <div className="flex flex-col rounded-xl border border-surface-border bg-white p-5">
      <div className="flex items-center justify-between">
        <Badge Logo={OmsCourierLogo} />
        <StatusPill connected={Boolean(business?.configured)}>
          {business?.configured ? "Configured" : "Not configured"}
        </StatusPill>
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900">Smartlane Business</h3>
      <p className="mt-1 flex-1 text-sm text-slate-500">
        Stores onboard as OMS Courier stores under FynkTech&apos;s Smartlane business account -
        KYC approvals, warehouses and requests.
      </p>
      {pending ? (
        <p className="mt-3 text-xs font-medium text-amber-700">
          {pending} {pending === 1 ? "request" : "requests"} awaiting review
        </p>
      ) : null}
      <Link
        href="/admin/oms-courier/smartlane-business"
        className="mt-5 inline-flex items-center justify-center rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
      >
        Open console
      </Link>
    </div>
  );
}

export default function OmsCourierPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await integrationsAdminService.getOmsCourier());
    } catch (err) {
      setError(err.message || "Failed to load OMS Courier");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">OMS Couriers</h1>
          <p className="mt-1 text-sm text-slate-500">
            FynkTech&apos;s own courier accounts, for the stores that hand their dispatching to
            FynkTech. Connect and manage them exactly the way a store admin does.
          </p>
        </div>
        <Link
          href="/admin/oms-courier/requests"
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-brand-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-900"
        >
          Requests
          {data?.pending_requests ? (
            <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-slate-900">
              {data.pending_requests}
            </span>
          ) : null}
        </Link>
      </div>

      <p className="rounded-lg border border-surface-border bg-white px-4 py-3 text-sm text-slate-600">
        Orders booked from the Dispatch Hub go through these accounts - for each store, only with
        the couriers it requested on its own OMS Courier page and you approved under Requests.
        Tracking numbers and status updates land on the store&apos;s own orders.
      </p>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {loading ? (
        <p className="px-1 py-10 text-sm text-slate-500">Loading accounts…</p>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ACCOUNTS.map((account) => (
            <AccountCard key={account.key} account={account} entry={data.accounts?.[account.key]} />
          ))}
          <SmartlaneBusinessCard business={data.smartlane_business} />
        </div>
      ) : null}
    </div>
  );
}
