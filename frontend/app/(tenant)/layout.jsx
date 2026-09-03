"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import LoadingOverlay from "../../components/shared/LoadingOverlay";
import TenantHeader from "../../components/layout/TenantHeader";
import ModuleSidebar from "../../components/layout/ModuleSidebar";
import {
  canAccessPath,
  getActiveModule,
  getDefaultModuleHref,
} from "../../components/layout/moduleNav";
import useAuthStore from "../../store/authStore";

function TenantShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const activeModule = getActiveModule(pathname);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  useEffect(() => {
    if (!user || !pathname) return;
    if (!canAccessPath(user, pathname)) {
      router.replace(getDefaultModuleHref(user));
    }
  }, [user, pathname, router]);

  return (
    <div className="min-h-screen bg-brand-800">
      <LoadingOverlay />
      <TenantHeader activeModule={activeModule} />
      <div className="flex">
        <ModuleSidebar
          activeModule={activeModule}
          expanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded((e) => !e)}
        />
        <main className="min-w-0 flex-1 rounded-tl-2xl bg-surface px-6 py-8">{children}</main>
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
