"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Dropdown from "../shared/Dropdown";
import GreenTick from "../shared/GreenTick";
import storesService from "../../services/storesService";
import useAuthStore, { useEffectiveUser } from "../../store/authStore";
import { invalidateViewCache } from "../../lib/viewCache";

function ChevronIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Store name on the header's right, with a switcher dropdown for org
 * admins who belong to more than one store. A super admin operating a
 * store (see ActingStoreBanner) just sees that store's name - their own
 * stores aren't the point while they're acting as someone else's. Same
 * for a plain staff login, which only ever belongs to one store. */
export default function StoreSwitcher() {
  const router = useRouter();
  const rawUser = useAuthStore((s) => s.user);
  const actingStore = useAuthStore((s) => s.actingStore);
  const effectiveUser = useEffectiveUser();
  const [stores, setStores] = useState(null);
  const [switching, setSwitching] = useState(false);

  const isActingSuperAdmin = rawUser?.role === "super_admin" && Boolean(actingStore);
  const canSwitch = Boolean(effectiveUser?.isOrgAdmin) && !isActingSuperAdmin;

  useEffect(() => {
    if (!canSwitch) return;
    let cancelled = false;
    storesService
      .list()
      .then((data) => {
        if (!cancelled) setStores(data);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canSwitch, effectiveUser?.organization_id]);

  if (!effectiveUser) return null;

  async function handleSwitch(store) {
    if (store.is_current || switching) return;
    setSwitching(true);
    try {
      await storesService.switchTo(store.id);
      invalidateViewCache();
      router.push("/dashboard");
    } catch (err) {
      window.alert(err.message || "Could not switch store");
    } finally {
      setSwitching(false);
    }
  }

  const label = (
    <span className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-white hover:bg-white/10">
      <span className="max-w-[10rem] truncate sm:max-w-[14rem]">
        {effectiveUser.organization_name || "Store"}
      </span>
      {canSwitch ? <ChevronIcon className="h-4 w-4 text-brand-100" /> : null}
    </span>
  );

  if (!canSwitch) {
    return <span className="shrink-0">{label}</span>;
  }

  const items = (stores || []).map((store) => ({
    key: store.id,
    label: (
      <span className="flex items-center gap-2">
        {store.is_current ? <GreenTick /> : <span className="h-4 w-4 shrink-0" />}
        <span className="truncate">{store.name}</span>
      </span>
    ),
    onClick: () => handleSwitch(store),
  }));

  return (
    <Dropdown
      align="right"
      disabled={switching}
      trigger={label}
      items={[
        ...(items.length
          ? items
          : [{ key: "loading", label: "Loading stores…", disabled: true }]),
        { key: "divider", divider: true },
        {
          key: "manage",
          label: "Manage stores",
          onClick: () => router.push("/settings?tab=stores"),
        },
      ]}
    />
  );
}
