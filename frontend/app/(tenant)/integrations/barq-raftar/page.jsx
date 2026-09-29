"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import barqraftarService from "./_lib/barqraftarService";
import useBarqRaftarStatusStore from "./_lib/barqraftarStatusStore";
import StatusCard from "./_components/StatusCard";
import ConnectForm from "./_components/ConnectForm";
import SettingsCard from "./_components/SettingsCard";
import ShipmentsTab from "./_components/ShipmentsTab";
import PickupAddressesTab from "./_components/PickupAddressesTab";
import PaymentsTab from "./_components/PaymentsTab";
import CitiesTab from "./_components/CitiesTab";

const TABS = [
  { key: "shipments", label: "Shipments" },
  { key: "pickup", label: "Pickup Addresses" },
  { key: "payments", label: "Payments" },
  { key: "cities", label: "Cities" },
];

function TruckIcon({ className }) {
  // Same mark as the Smartlane integration page's TruckIcon, in
  // BarqRaftar's own colour so the two pages read as visually distinct at
  // a glance.
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M2 7h11v9H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 10h4l4 3v3h-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="6.5" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17.5" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function BarqRaftarIntegrationPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("shipments");

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const data = await barqraftarService.getConnection();
      setStatus(data);
      return data;
    } catch (err) {
      setError(err.message || "Failed to load integration status");
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Keeps the shared status store (read by the orders page's "Book with
  // BarqRaftar" / "Print BarqRaftar Labels" actions) in sync whenever this
  // page connects/disconnects/updates settings - without this, those
  // actions would only pick up a change after a full orders-page reload.
  function refreshSharedStatus() {
    barqraftarService
      .getStatus()
      .then((d) => useBarqRaftarStatusStore.getState().setStatus(d))
      .catch(() => {});
  }

  useEffect(() => {
    loadStatus();
    refreshSharedStatus();
  }, []);

  async function handleConnected(data) {
    setStatus(data);
    setNotice("Connected to BarqRaftar.");
    setError("");
    refreshSharedStatus();
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect BarqRaftar? Existing shipments stay booked on BarqRaftar's side.")) {
      return;
    }
    try {
      await barqraftarService.disconnect();
      setStatus(null);
      setNotice("Disconnected from BarqRaftar.");
      refreshSharedStatus();
    } catch (err) {
      setError(err.message || "Failed to disconnect");
    }
  }

  const connected = Boolean(status?.connected);

  return (
    <div>
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/integrations" className="hover:text-slate-700">
          Integrations
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-700">BarqRaftar</span>
      </nav>

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-white shadow-sm">
          <TruckIcon className="h-6 w-6 text-red-600" />
        </span>
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900">BarqRaftar</h1>
          <p className="text-sm text-slate-500">
            Book, print, track and reconcile BarqRaftar shipments straight from your orders.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : connected ? (
            <>
              <StatusCard
                status={status}
                onChanged={loadStatus}
                onDisconnect={handleDisconnect}
                onError={setError}
                onNotice={setNotice}
              />
              <SettingsCard
                status={status}
                onChanged={() => {
                  loadStatus();
                  refreshSharedStatus();
                }}
                onError={setError}
                onNotice={setNotice}
              />
            </>
          ) : (
            <ConnectForm onConnected={handleConnected} onError={setError} />
          )}
        </div>

        <div>
          {connected ? (
            <>
              <div className="mb-4 flex gap-1 border-b border-surface-border">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-2 text-sm font-medium transition ${
                      tab === t.key
                        ? "border-b-2 border-brand-700 text-brand-800"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {tab === "shipments" ? <ShipmentsTab onError={setError} /> : null}
              {tab === "pickup" ? (
                <PickupAddressesTab
                  status={status}
                  onChanged={() => {
                    loadStatus();
                    refreshSharedStatus();
                  }}
                  onError={setError}
                  onNotice={setNotice}
                />
              ) : null}
              {tab === "payments" ? <PaymentsTab onError={setError} /> : null}
              {tab === "cities" ? <CitiesTab status={status} onError={setError} onNotice={setNotice} /> : null}
            </>
          ) : (
            <p className="rounded-lg border border-surface-border bg-white p-6 text-sm text-slate-500">
              Connect your BarqRaftar account to see shipments, pickup addresses, payments and cities here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
