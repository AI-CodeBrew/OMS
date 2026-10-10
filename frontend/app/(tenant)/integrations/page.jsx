"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import integrationsService from "../../../services/integrationsService";
import barqraftarService from "./barq-raftar/_lib/barqraftarService";
import postexService from "./postex/_lib/postexService";
import GreenTick from "../../../components/shared/GreenTick";
import {
  Badge,
  BarqRaftarWordmark,
  OmsCourierLogo,
  PostExWordmark,
  ShopifyLogo,
  SmartlaneLogo,
} from "../../../components/integrations/IntegrationLogos";
import { useBankDetailsGate } from "../../../lib/useBankDetailsGate";
import BankDetailsModal from "../../../components/billing/BankDetailsModal";

function CheckDot({ children }) {
  return (
    <li className="flex items-center gap-2 text-sm text-slate-600">
      <GreenTick />
      {children}
    </li>
  );
}

function SoonDot({ children }) {
  return (
    <li className="flex items-center gap-2 text-sm text-slate-400">
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-slate-300">
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
      </svg>
      {children}
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">soon</span>
    </li>
  );
}

const INTEGRATIONS = [
  {
    key: "shopify",
    name: "Shopify",
    tagline: "Connect your Shopify store to import orders, products and customers.",
    logo: ShopifyLogo,
    href: "/integrations/shopify",
    live: true,
    features: [
      { label: "Import Orders", done: true },
      { label: "Real-time Webhooks", done: true },
      { label: "Sync Products", done: false },
      { label: "Sync Customers", done: false },
    ],
  },
  {
    key: "smartlane",
    name: "Smartlane",
    tagline: "Real-time shipment tracking via webhook, straight into your orders.",
    logo: SmartlaneLogo,
    href: "/integrations/smartlane",
    live: true,
    features: [
      { label: "Real-time Status Webhook", done: true },
      { label: "Auto Order Updates", done: true },
      { label: "Create Bookings", done: false },
      { label: "Real-time Rate Quotes", done: false },
    ],
  },
  {
    key: "oms_courier",
    name: "OMS Courier",
    tagline: "FynkTech dispatches your orders through its own courier accounts - no signup needed.",
    logo: OmsCourierLogo,
    href: "/integrations/oms-courier",
    live: true,
    features: [
      { label: "Smartlane, PostEx & BarqRaftar", done: true },
      { label: "FynkTech Books & Dispatches", done: true },
      { label: "Live Tracking on Your Orders", done: true },
    ],
  },
  {
    key: "barq_raftar",
    name: "BarqRaftar",
    tagline: "Connect to BarqRaftar for fast domestic deliveries.",
    logo: BarqRaftarWordmark,
    wordmark: true,
    href: "/integrations/barq-raftar",
    live: true,
    features: [
      { label: "Create Shipments", done: true },
      { label: "Print Labels", done: true },
      { label: "Track Shipments", done: true },
      { label: "COD Reconciliation", done: false },
    ],
  },
  {
    key: "postex",
    name: "PostEx",
    tagline: "Integrate PostEx for efficient postal and courier deliveries.",
    logo: PostExWordmark,
    wordmark: true,
    href: "/integrations/postex",
    live: true,
    features: [
      { label: "Create Shipments", done: true },
      { label: "Airway Bills & Load Sheets", done: true },
      { label: "Auto Status Updates", done: true },
      { label: "COD Settlement Status", done: true },
    ],
  },
];

function IntegrationCard({ integration, connected, onConnect }) {
  return (
    <div
      className={`flex flex-col rounded-xl border border-surface-border bg-white p-5 ${
        integration.live ? "" : "opacity-80"
      }`}
    >
      <div className="flex items-center justify-between">
        <Badge Logo={integration.logo} wordmark={integration.wordmark} />
        {!integration.live ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            Coming Soon
          </span>
        ) : connected ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
            Connected
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-900">{integration.name}</h3>
      <p className="mt-1 text-sm text-slate-500">{integration.tagline}</p>

      <ul className="mt-4 flex-1 space-y-2">
        {integration.features.map((f) =>
          f.done ? (
            <CheckDot key={f.label}>{f.label}</CheckDot>
          ) : (
            <SoonDot key={f.label}>{f.label}</SoonDot>
          )
        )}
      </ul>

      {integration.live && connected ? (
        <Link
          href={integration.href}
          className="mt-5 inline-flex items-center justify-center rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
        >
          Manage {integration.name}
        </Link>
      ) : integration.live ? (
        <button
          type="button"
          onClick={() => onConnect(integration.href)}
          className="mt-5 inline-flex items-center justify-center rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
        >
          Connect {integration.name}
        </button>
      ) : (
        <button
          type="button"
          disabled
          className="mt-5 inline-flex cursor-not-allowed items-center justify-center rounded-md border border-surface-border px-4 py-2 text-sm font-medium text-slate-400"
        >
          Coming Soon
        </button>
      )}
    </div>
  );
}

function HeroGraphic() {
  return (
    <div className="-mt-12 ml-[15%] hidden shrink-0 md:block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/integrations-hero.png"
        alt="Shopify, Smartlane, Leopard Courier and PostEx connecting into your OMS"
        className="h-64 w-[470px] object-contain drop-shadow-sm"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

export default function IntegrationsOverviewPage() {
  const router = useRouter();
  const [connectedMap, setConnectedMap] = useState({});
  const { requireBankDetails, modalProps } = useBankDetailsGate();

  function onConnect(href) {
    requireBankDetails(() => router.push(href));
  }

  useEffect(() => {
    integrationsService
      .getShopifyStatus()
      .then((d) => setConnectedMap((m) => ({ ...m, shopify: Boolean(d.connected) })))
      .catch(() => {});
    integrationsService
      .getSmartlaneStatus()
      .then((d) => setConnectedMap((m) => ({ ...m, smartlane: Boolean(d.connected) })))
      .catch(() => {});
    barqraftarService
      .getStatus()
      .then((d) => setConnectedMap((m) => ({ ...m, barq_raftar: Boolean(d.connected) })))
      .catch(() => {});
    postexService
      .getStatus()
      .then((d) => setConnectedMap((m) => ({ ...m, postex: Boolean(d.connected) })))
      .catch(() => {});
    integrationsService
      .getOmsCourierOnboarding()
      .then((d) => d.live && setConnectedMap((m) => ({ ...m, oms_courier: true })))
      .catch(() => {});
    // Either way counts: onboarded through Smartlane Business, or at least
    // one courier approved for FynkTech to book with.
    integrationsService
      .getOmsCourierCouriers()
      .then(
        (d) =>
          (d.couriers || []).some((c) => c.is_enabled && c.status === "approved") &&
          setConnectedMap((m) => ({ ...m, oms_courier: true }))
      )
      .catch(() => {});
  }, []);

  return (
    <div>
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-slate-500">
        <span>Integrations</span>
        <span>/</span>
        <span className="font-medium text-slate-700">Connectivity</span>
      </nav>

      <div className="flex flex-wrap items-center gap-6">
        <div className="max-w-xl">
          <h1 className="text-[28px] font-semibold leading-9 text-slate-900">Connect your services</h1>
          <p className="mt-2 text-sm text-slate-500">
            Integrate with your favorite platforms and logistics partners to streamline your
            operations.
          </p>
        </div>

        <HeroGraphic />
      </div>

      <h2 className="mb-3 mt-0 text-sm font-semibold text-slate-700">Available Integrations</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {INTEGRATIONS.map((integration) => (
          <IntegrationCard
            key={integration.key}
            integration={integration}
            connected={Boolean(connectedMap[integration.key])}
            onConnect={onConnect}
          />
        ))}
      </div>

      <BankDetailsModal {...modalProps} />
    </div>
  );
}
