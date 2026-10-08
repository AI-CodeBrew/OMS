"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import postexService from "./_lib/postexService";
import usePostExStatusStore from "./_lib/postexStatusStore";
import StatusCard from "./_components/StatusCard";
import ConnectForm from "./_components/ConnectForm";
import SettingsCard from "./_components/SettingsCard";
import ShipmentsTab from "./_components/ShipmentsTab";
import PickupAddressesTab from "./_components/PickupAddressesTab";
import CitiesTab from "./_components/CitiesTab";

const TABS = [
  { key: "shipments", label: "Shipments" },
  { key: "pickup", label: "Pickup Addresses" },
  { key: "cities", label: "Cities" },
];

// Same wordmark as the PostEx card on the Integrations overview page.
function PostExWordmark() {
  return (
    <span className="text-[13px] font-extrabold tracking-tight">
      <span className="text-blue-800">POST</span>
      <span className="text-red-600">EX</span>
    </span>
  );
}

export default function PostExIntegrationPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("shipments");

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const data = await postexService.getConnection();
      setStatus(data);
      return data;
    } catch (err) {
      setError(err.message || "Failed to load integration status");
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Keeps the shared status store (read by the orders page's PostEx
  // actions) in sync with connect/disconnect/settings changes here.
  function refreshSharedStatus() {
    postexService
      .getStatus()
      .then((d) => usePostExStatusStore.getState().setStatus(d))
      .catch(() => {});
  }

  function onChanged() {
    loadStatus();
    refreshSharedStatus();
  }

  useEffect(() => {
    loadStatus();
    refreshSharedStatus();
  }, []);

  function handleConnected(data) {
    setStatus(data);
    setNotice(
      data.pickup_address_code
        ? "Connected to PostEx."
        : "Connected to PostEx. Set an active pickup address before booking."
    );
    setError("");
    refreshSharedStatus();
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect PostEx? Existing shipments stay booked on PostEx's side.")) return;
    try {
      await postexService.disconnect();
      setStatus(null);
      setNotice("Disconnected from PostEx.");
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
        <span className="font-medium text-slate-700">PostEx</span>
      </nav>

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-white shadow-sm">
          <PostExWordmark />
        </span>
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900">PostEx</h1>
          <p className="text-sm text-slate-500">
            Book orders, print airway bills and load sheets, and keep statuses in sync with your PostEx account.
          </p>
        </div>
      </div>

      {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}

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
              <SettingsCard status={status} onChanged={onChanged} onError={setError} onNotice={setNotice} />
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
              {tab === "shipments" ? <ShipmentsTab onError={setError} onNotice={setNotice} /> : null}
              {tab === "pickup" ? (
                <PickupAddressesTab status={status} onChanged={onChanged} onError={setError} onNotice={setNotice} />
              ) : null}
              {tab === "cities" ? (
                <CitiesTab status={status} onChanged={onChanged} onError={setError} onNotice={setNotice} />
              ) : null}
            </>
          ) : (
            <p className="rounded-lg border border-surface-border bg-white p-6 text-sm text-slate-500">
              Connect your PostEx account to see shipments, pickup addresses and cities here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
