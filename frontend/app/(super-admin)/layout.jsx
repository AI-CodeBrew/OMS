"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import authService from "../../services/authService";
import useAuthStore from "../../store/authStore";
import { invalidateViewCache } from "../../lib/viewCache";

const NAV = [
  {
    href: "/admin/organizations",
    label: "Organizations",
    match: (path) => path.startsWith("/admin/organizations") || path === "/admin",
  },
  {
    href: "/admin/stores",
    label: "Stores",
    match: (path) => path.startsWith("/admin/stores"),
  },
  {
    href: "/admin/dispatch-hub",
    label: "Dispatch Hub",
    match: (path) => path.startsWith("/admin/dispatch-hub"),
  },
  {
    href: "/admin/invoices",
    label: "Invoices",
    match: (path) => path.startsWith("/admin/invoices"),
  },
  {
    href: "/admin/integrations",
    label: "Integrations",
    match: (path) => path.startsWith("/admin/integrations"),
  },
  {
    href: "/admin/oms-courier",
    label: "OMS Courier",
    match: (path) => path.startsWith("/admin/oms-courier") || path.startsWith("/admin/smartlane"),
  },
  {
    href: "/admin/tickets",
    label: "Tickets",
    match: (path) => path.startsWith("/admin/tickets"),
  },
];

const PLATFORM_ACCOUNT_PAGES = ["barq-raftar", "postex", "smartlane"].map(
  (slug) => `/admin/oms-courier/${slug}`
);

function isPlatformAccountPage(path) {
  return PLATFORM_ACCOUNT_PAGES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function SuperAdminShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const actingStore = useAuthStore((s) => s.actingStore);
  const exitStore = useAuthStore((s) => s.exitStore);

  // Reaching the panel (e.g. via browser Back) means we're no longer operating a store.
  // Acting as the platform org is the OMS Courier tab's own business - its
  // layout enters and leaves it.
  useEffect(() => {
    if (!actingStore || actingStore.platform) return;
    exitStore();
    invalidateViewCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    authService.logout();
    router.replace("/superadmin");
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="flex w-56 shrink-0 flex-col border-r border-surface-border bg-brand-900 text-white">
        <div className="border-b border-white/10 px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">
            OMS
          </p>
          <p className="mt-0.5 text-sm font-semibold text-white">Super Admin</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-brand-100 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-md border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        {/* The OMS Courier account pages are the store admin's own
            integration screens (tables, tabs) - give them the width they
            were built for. */}
        <div
          className={`mx-auto px-6 py-8 ${
            isPlatformAccountPage(pathname) ? "max-w-7xl" : "max-w-5xl"
          }`}
        >
          {children}
        </div>
      </main>
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
