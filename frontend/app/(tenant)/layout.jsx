"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import LoadingOverlay from "../../components/shared/LoadingOverlay";
import TenantHeader from "../../components/layout/TenantHeader";
import ModuleSidebar from "../../components/layout/ModuleSidebar";
import ActingStoreBanner from "../../components/layout/ActingStoreBanner";
import CriticalOrdersAlert from "../../components/orders/CriticalOrdersAlert";
import {
  canAccessPath,
  getActiveModule,
  getDefaultModuleHref,
  getVisibleModules,
} from "../../components/layout/moduleNav";
import useAuthStore, { useEffectiveUser } from "../../store/authStore";
import authService, {
  ORG_SUSPENDED_CODE,
  ORG_SUSPENDED_MESSAGE,
  setLoginNotice,
} from "../../services/authService";
import healthService from "../../services/healthService";

const LAST_MODULE_KEY = "oms.lastModule";

function TenantShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useEffectiveUser();
  const actingStore = useAuthStore((s) => s.actingStore);
  const activeModule = getActiveModule(pathname);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [lastModule, setLastModule] = useState(null);
  const superAdminWithoutStore = user?.role === "super_admin" && !actingStore;

  // Shared pages (Integrations, Logs, Report, Batch, Tickets, Settings)
  // belong to no module, so they keep showing the sidebar - and header tab -
  // of whichever module (OMS/WMS/Financify) the user came from, instead of
  // an empty sidebar with no way back to Dashboard/All Orders.
  const visibleModules = getVisibleModules(user);
  const isProductModule = visibleModules.some((m) => m.key === activeModule);
  const navModule = isProductModule
    ? activeModule
    : visibleModules.find((m) => m.key === lastModule)?.key || visibleModules[0]?.key || activeModule;

  useEffect(() => {
    try {
      setLastModule(window.sessionStorage.getItem(LAST_MODULE_KEY));
    } catch {
      // Storage blocked - fall back to the first visible module.
    }
  }, []);

  useEffect(() => {
    if (!isProductModule) return;
    setLastModule(activeModule);
    try {
      window.sessionStorage.setItem(LAST_MODULE_KEY, activeModule);
    } catch {
      // Storage blocked - remembered for this tab's session only.
    }
  }, [activeModule, isProductModule]);

  useEffect(() => {
    if (!user || !pathname) return;
    if (superAdminWithoutStore) {
      router.replace("/admin/stores");
      return;
    }
    if (!canAccessPath(user, pathname)) {
      router.replace(getDefaultModuleHref(user));
    }
  }, [user, pathname, router, superAdminWithoutStore]);

  // The backend refuses every request from a suspended (or removed)
  // organization; checked on each navigation so a user already signed in
  // when it happened is signed out with the reason, rather than left on
  // pages that all fail.
  const signedInAsTenant = Boolean(user) && user.role !== "super_admin";
  useEffect(() => {
    if (!signedInAsTenant) return undefined;
    let cancelled = false;
    healthService.getProtectedHealth().catch(async (err) => {
      if (cancelled || err.code !== ORG_SUSPENDED_CODE) return;
      setLoginNotice(ORG_SUSPENDED_MESSAGE);
      await authService.logout();
      router.replace("/login");
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, signedInAsTenant, router]);

  if (superAdminWithoutStore) return null;

  return (
    <div className="min-h-screen bg-brand-800">
      <LoadingOverlay />
      <CriticalOrdersAlert />
      <ActingStoreBanner />
      <TenantHeader activeModule={navModule} />
      <div className="flex">
        <ModuleSidebar
          activeModule={navModule}
          expanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded((e) => !e)}
        />
        {/* sticky + own scroll, matching ModuleSidebar's own top-16/
            h-[calc(100vh-4rem)] treatment - otherwise the whole document
            scrolls and rounded-tl-2xl (a fixed feature of this box's own
            top edge) scrolls out of view after the first scroll, leaving a
            flat/square corner instead of the rounded one. */}
        <main className="sticky top-16 h-[calc(100vh-4rem)] min-w-0 flex-1 overflow-y-auto rounded-tl-2xl bg-surface px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function TenantLayout({ children }) {
  return (
    <ProtectedRoute>
      <TenantShell>{children}</TenantShell>
    </ProtectedRoute>
  );
}
