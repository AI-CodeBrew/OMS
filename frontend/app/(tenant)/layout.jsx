"use client";

import ProtectedRoute from "../../components/shared/ProtectedRoute";
import authService from "../../services/authService";
import Button from "../../components/shared/Button";
import { useRouter } from "next/navigation";
import useAuthStore from "../../store/authStore";

function TenantShell({ children }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  function logout() {
    authService.logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-surface-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-bold uppercase tracking-wide text-brand-700">
              OMS
            </span>
            <nav className="flex gap-4 text-sm text-slate-600">
              <a href="/orders" className="hover:text-brand-600">
                Orders
              </a>
              <a href="/ops" className="hover:text-brand-600">
                OPS
              </a>
              <a href="/wms" className="hover:text-brand-600">
                WMS
              </a>
              <a href="/returns" className="hover:text-brand-600">
                Returns
              </a>
              <a href="/finance" className="hover:text-brand-600">
                Finance
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{user?.email}</span>
            <Button variant="secondary" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
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
