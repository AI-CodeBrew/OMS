"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import TenantHeader from "../../components/layout/TenantHeader";
import ModuleSidebar from "../../components/layout/ModuleSidebar";
import { getActiveModule } from "../../components/layout/moduleNav";

function TenantShell({ children }) {
  const pathname = usePathname();
  const activeModule = getActiveModule(pathname);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="min-h-screen bg-brand-800">
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
