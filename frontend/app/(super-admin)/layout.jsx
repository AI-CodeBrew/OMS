"use client";

import ProtectedRoute from "../../components/shared/ProtectedRoute";
import authService from "../../services/authService";
import Button from "../../components/shared/Button";
import { useRouter } from "next/navigation";

function SuperAdminShell({ children }) {
  const router = useRouter();

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
              OMS Super Admin
            </span>
            <nav className="flex gap-4 text-sm text-slate-600">
              <a href="/tenants" className="hover:text-brand-600">
                Tenants
              </a>
              <a href="/system-health" className="hover:text-brand-600">
                System health
              </a>
            </nav>
          </div>
          <Button variant="secondary" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

export default function SuperAdminLayout({ children }) {
  return (
    <ProtectedRoute requireSuperAdmin>
      <SuperAdminShell>{children}</SuperAdminShell>
    </ProtectedRoute>
  );
}
