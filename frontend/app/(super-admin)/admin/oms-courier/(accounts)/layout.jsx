"use client";

import { useEffect, useState } from "react";
import integrationsAdminService from "../../../../../services/integrationsAdminService";
import useAuthStore from "../../../../../store/authStore";
import { invalidateViewCache } from "../../../../../lib/viewCache";
import LoadingOverlay from "../../../../../components/shared/LoadingOverlay";
import { IntegrationsHomeProvider } from "../../../../../components/integrations/IntegrationsHome";

const HOME = { href: "/admin/oms-courier", label: "OMS Couriers" };

// FynkTech's own BarqRaftar / PostEx / Smartlane accounts are managed on the
// store admin's own integration pages, acting as the hidden platform org
// that holds them (core.platform_service). The pages fire their API calls
// on mount, so they only render once the act-as header is in place.
export default function PlatformAccountsLayout({ children }) {
  const enterPlatform = useAuthStore((s) => s.enterPlatform);
  const exitStore = useAuthStore((s) => s.exitStore);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    integrationsAdminService
      .getOmsCourier()
      .then((data) => {
        if (cancelled) return;
        enterPlatform({ id: data.organization.id, name: data.organization.name, modules: [] });
        invalidateViewCache();
        setReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not open OMS Courier");
      });
    return () => {
      cancelled = true;
      exitStore();
      invalidateViewCache();
    };
  }, [enterPlatform, exitStore]);

  return (
    <IntegrationsHomeProvider value={HOME}>
      <LoadingOverlay />
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : ready ? (
        children
      ) : (
        <p className="px-1 py-10 text-sm text-slate-500">Loading…</p>
      )}
    </IntegrationsHomeProvider>
  );
}
