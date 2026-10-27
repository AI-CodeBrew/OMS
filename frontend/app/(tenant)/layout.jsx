"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import LoadingOverlay from "../../components/shared/LoadingOverlay";
import TenantHeader from "../../components/layout/TenantHeader";
import ModuleSidebar, { MobileNav } from "../../components/layout/ModuleSidebar";
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
  ACCESS_REVOKED_CODE,
  ORG_SUSPENDED_CODE,
  ORG_SUSPENDED_MESSAGE,
  setLoginNotice,
} from "../../services/authService";
import healthService from "../../services/healthService";

const LAST_MODULE_KEY = "oms.lastModule";

function accessSignature({ role, modules }) {
  return `${role}|${[...(modules || [])].sort().join(",")}`;
}

// True when the backend's live access (Membership row) differs from the
// stored user's JWT snapshot - an admin changed this person's role/modules.
function accessChanged(storedUser, access) {
  if (!storedUser || !access) return false;
  const storedRole = storedUser.role === "org_admin" ? "org_admin" : "org_user";
  return accessSignature({ role: storedRole, modules: storedUser.modules }) !== accessSignature(access);
}

function TenantShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useEffectiveUser();
  const actingStore = useAuthStore((s) => s.actingStore);
  const activeModule = getActiveModule(pathname);
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
  // Last live access a refresh was already tried for - if Supabase's token
  // still disagrees afterwards, don't refresh again on every navigation.
  const refreshedFor = useRef("");
  useEffect(() => {
    if (!signedInAsTenant) return undefined;
    let cancelled = false;
    healthService
      .getProtectedHealth()
      .then(async (data) => {
        // Role/modules changed by an admin: pick up the new token now, so
        // the sidebar, header tabs and route guard follow without a re-login.
        const access = data?.access;
        if (cancelled || !accessChanged(useAuthStore.getState().user, access)) return;
        const signature = accessSignature(access);
        if (refreshedFor.current === signature) return;
        refreshedFor.current = signature;
        await authService.refreshUser().catch(() => null);
      })
      .catch(async (err) => {
        if (cancelled) return;
        if (err.code !== ORG_SUSPENDED_CODE && err.code !== ACCESS_REVOKED_CODE) return;
        setLoginNotice(err.code === ORG_SUSPENDED_CODE ? ORG_SUSPENDED_MESSAGE : err.message);
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
      <MobileNav activeModule={navModule} />
      <div className="flex">
        <ModuleSidebar activeModule={navModule} />
        {/* sticky + own scroll, matching ModuleSidebar's own top-16/
            h-[calc(100vh-4rem)] treatment - otherwise the whole document
            scrolls and rounded-tl-2xl (a fixed feature of this box's own
            top edge) scrolls out of view after the first scroll, leaving a
            flat/square corner instead of the rounded one. */}
        {/* Phones: no rail beside it (MobileNav is above instead), so it's
            a plain full-width block that scrolls with the page - the
            sticky/fixed-height box only applies from md up. */}
        <main className="min-h-[calc(100vh-4rem)] min-w-0 flex-1 bg-surface px-4 py-5 md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:min-h-0 md:overflow-y-auto md:rounded-tl-2xl md:px-6 md:py-8">
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
