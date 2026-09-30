"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import LoadingOverlay from "../../components/shared/LoadingOverlay";
import TenantHeader from "../../components/layout/TenantHeader";
import ModuleSidebar from "../../components/layout/ModuleSidebar";
import ActingStoreBanner from "../../components/layout/ActingStoreBanner";
import {
  canAccessPath,
  getActiveModule,
  getDefaultModuleHref,
} from "../../components/layout/moduleNav";
import useAuthStore, { useEffectiveUser } from "../../store/authStore";

function TenantShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useEffectiveUser();
  const actingStore = useAuthStore((s) => s.actingStore);
  const activeModule = getActiveModule(pathname);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const superAdminWithoutStore = user?.role === "super_admin" && !actingStore;

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

  if (superAdminWithoutStore) return null;

  return (
    <div className="min-h-screen bg-brand-800">
      <LoadingOverlay />
      <ActingStoreBanner />
      <TenantHeader activeModule={activeModule} />
      <div className="flex">
        <ModuleSidebar
          activeModule={activeModule}
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
