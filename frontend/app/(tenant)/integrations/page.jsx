"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import integrationsService from "../../../services/integrationsService";

function ShopifyLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M17.3 5.3c-.1-.1-.3-.2-.4-.2l-1.5-.1-1.1-1.1c-.1-.1-.3-.1-.4-.1l-.6.2c-.1-.3-.3-.6-.5-.8-.4-.5-1-.7-1.6-.6-.1 0-.2 0-.3.1-.2-.2-.4-.4-.7-.5-1.4-.5-2.9.5-3.5 2.4l-1.3.4c-.4.1-.4.1-.5.5L3.5 19l10.4 2 5.6-1.2c0-.1-2.1-14.4-2.2-14.5ZM11.4 4c-.4.1-.9.3-1.3.5.1-.5.4-1 .8-1.3.4.2.5.5.5.8ZM10 3.1c.1 0 .2 0 .3.1-.5.4-.9 1-1.1 1.7l-1 .3c.3-1 1-1.9 1.8-2.1Zm-.7 4.2c0 .1-1.3.4-1.3.4S7.3 6.4 8.6 6.1c.3-.9.7-1.6 1.2-2 .1 0 .1-.1.2-.1.4.5.6 1.2.6 2-.4.1-.9.2-1.3.3Zm2.3-.7c-.4.1-.8.2-1.3.4.1-.6.2-1.2-.1-1.7l.1-.1c.6-.1 1 .5 1.3 1.4Z"
        fill="#95BF47"
      />
      <path
        d="M16.9 5.1l-1.5-.1-1.1-1.1c-.1-.1-.3-.1-.4-.1l-.6.2c-.1-.3-.3-.6-.5-.8-.4-.5-1-.7-1.6-.6l-.5 15.9 5.6-1.2c0-.1-2.1-14.4-2.2-14.5.4 0 .8.1.8.1Z"
        fill="#5E8E3E"
      />
      <path
        d="M12.5 8.9l-.6 1.8s-.6-.3-1.4-.3c-1.1 0-1.2.7-1.2.9 0 .9 2.5 1.3 2.5 3.6 0 1.8-1.1 2.9-2.6 2.9-1.8 0-2.8-1.1-2.8-1.1l.5-1.6s1 .9 1.9.9c.6 0 .8-.5.8-.8 0-1.2-2.1-1.3-2.1-3.4 0-1.7 1.2-3.4 3.7-3.4.9.1 1.3.5 1.3.5Z"
        fill="#FFFFFE"
      />
    </svg>
  );
}

function SmartlaneLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" fill="#111827" />
      <path
        d="M3 15.5 12 11l9 4.5-9 4.5-9-4.5Z"
        fill="none"
        stroke="#111827"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LeopardWordmark({ className }) {
  return (
    <span className={`font-black italic tracking-tight text-slate-900 ${className || ""}`}>
      Leopard<span className="text-orange-500">s</span>
    </span>
  );
}

function PostExWordmark({ className }) {
  return (
    <span className={`font-extrabold tracking-tight ${className || ""}`}>
      <span className="text-blue-800">POST</span>
      <span className="text-red-600">EX</span>
    </span>
  );
}

function CheckDot({ children }) {
  return (
    <li className="flex items-center gap-2 text-sm text-slate-600">
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-green-500">
        <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" />
        <path d="M6.5 10.2 9 12.5l4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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

// Badge = the small white rounded-square icon tile used both in the card
// grid and the hero graphic below, so both places render the exact same
// logo mark.
function Badge({ Logo, size = 12, wordmark = false }) {
  const dim = size === 12 ? "h-12 w-12" : size === 14 ? "h-14 w-14" : "h-11 w-11";
  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-xl border border-surface-border bg-white shadow-sm ${
        wordmark ? "px-2" : ""
      }`}
    >
      {wordmark ? <Logo className="text-[11px]" /> : <Logo className="h-6 w-6" />}
    </span>
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
    key: "leopard",
    name: "Leopard Courier",
    tagline: "Connect to Leopard Courier for seamless domestic shipping.",
    logo: LeopardWordmark,
    wordmark: true,
    href: null,
    live: false,
    features: [
      { label: "Create Shipments", done: false },
      { label: "Print Labels", done: false },
      { label: "Track Shipments", done: false },
      { label: "COD Reconciliation", done: false },
    ],
  },
  {
    key: "postex",
    name: "PostEx",
    tagline: "Integrate PostEx for efficient postal and courier deliveries.",
    logo: PostExWordmark,
    wordmark: true,
    href: null,
    live: false,
    features: [
      { label: "Create Shipments", done: false },
      { label: "Print Labels", done: false },
      { label: "Track Shipments", done: false },
      { label: "Delivery Confirmation", done: false },
    ],
  },
];

function IntegrationCard({ integration, connected }) {
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

      {integration.live ? (
        <Link
          href={integration.href}
          className="mt-5 inline-flex items-center justify-center rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
        >
          {connected ? `Manage ${integration.name}` : `Connect ${integration.name}`}
        </Link>
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
  const [connectedMap, setConnectedMap] = useState({});

  useEffect(() => {
    integrationsService
      .getShopifyStatus()
      .then((d) => setConnectedMap((m) => ({ ...m, shopify: Boolean(d.connected) })))
      .catch(() => {});
    integrationsService
      .getSmartlaneStatus()
      .then((d) => setConnectedMap((m) => ({ ...m, smartlane: Boolean(d.connected) })))
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
          />
        ))}
      </div>
    </div>
  );
}
