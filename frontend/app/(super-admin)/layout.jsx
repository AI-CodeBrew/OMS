"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import authService from "../../services/authService";
import useAuthStore from "../../store/authStore";
import { invalidateViewCache } from "../../lib/viewCache";
import {
  LayersIcon,
  ShopBagIcon,
  ReceiptIcon,
  TruckIcon,
  PackageIcon,
  CardIcon,
  IntegrationsIcon,
  LinkIcon,
  HistoryIcon,
  TicketIcon,
  GridIcon,
} from "../../components/layout/navIcons";

const NAV = [
  {
    href: "/admin/organizations",
    label: "Organizations",
    icon: LayersIcon,
    match: (path) => path.startsWith("/admin/organizations") || path === "/admin",
  },
  {
    href: "/admin/stores",
    label: "Stores",
    icon: ShopBagIcon,
    match: (path) => path.startsWith("/admin/stores"),
  },
  {
    href: "/admin/all-orders",
    label: "All Orders",
    icon: ReceiptIcon,
    match: (path) => path.startsWith("/admin/all-orders"),
  },
  {
    href: "/admin/dispatch-hub",
    label: "Dispatch Hub",
    icon: TruckIcon,
    match: (path) => path.startsWith("/admin/dispatch-hub"),
  },
  {
    href: "/admin/inventory",
    label: "Inventory",
    icon: PackageIcon,
    match: (path) => path.startsWith("/admin/inventory"),
  },
  {
    href: "/admin/invoices",
    label: "Invoices",
    icon: CardIcon,
    match: (path) => path.startsWith("/admin/invoices"),
  },
  {
    href: "/admin/integrations",
    label: "Integrations",
    icon: IntegrationsIcon,
    match: (path) => path.startsWith("/admin/integrations"),
  },
  {
    href: "/admin/oms-courier",
    label: "OMS Couriers",
    icon: LinkIcon,
    match: (path) => path.startsWith("/admin/oms-courier") || path.startsWith("/admin/smartlane"),
  },
  {
    href: "/admin/logs",
    label: "Logs",
    icon: HistoryIcon,
    match: (path) => path.startsWith("/admin/logs"),
  },
  {
    href: "/admin/tickets",
    label: "Tickets",
    icon: TicketIcon,
    match: (path) => path.startsWith("/admin/tickets"),
  },
  {
    href: "/admin/cities",
    label: "Cities",
    icon: GridIcon,
    match: (path) => path.startsWith("/admin/cities"),
  },
];

const PLATFORM_ACCOUNT_PAGES = ["barq-raftar", "postex", "leopards", "smartlane"].map(
  (slug) => `/admin/oms-courier/${slug}`
);

function isPlatformAccountPage(path) {
  return PLATFORM_ACCOUNT_PAGES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Pages that need more than the panel's usual reading width.
function isWidePage(path) {
  return isPlatformAccountPage(path) || path.startsWith("/admin/logs");
}

function SuperAdminShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const actingStore = useAuthStore((s) => s.actingStore);
  const exitStore = useAuthStore((s) => s.exitStore);
  const [expanded, setExpanded] = useState(false);

  // Leaving for another page shouldn't leave the sidebar open over it.
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

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
      {/* Same as a store's sidebar: an icon rail that opens while the
          pointer is over it and folds back when it leaves. The outer w-14
          box holds the rail's place, so the opened panel slides over the
          page instead of pushing it sideways. */}
      <div className="relative z-40 w-14 shrink-0">
        <aside
          onMouseEnter={() => setExpanded(true)}
          onMouseLeave={() => setExpanded(false)}
          className={`sticky top-0 flex h-screen flex-col overflow-y-auto overflow-x-hidden border-r border-brand-900 bg-brand-900 text-white transition-all duration-150 ${
            expanded ? "w-56 shadow-2xl" : "w-14"
          }`}
        >
          <div className={`border-b border-white/10 py-4 ${expanded ? "px-5" : "px-0 text-center"}`}>
            {expanded ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">OMS</p>
                <p className="mt-0.5 whitespace-nowrap text-sm font-semibold text-white">Super Admin</p>
              </>
            ) : (
              <p className="text-xs font-bold uppercase tracking-wider text-brand-200" title="OMS Super Admin">
                SA
              </p>
            )}
          </div>
          <nav className={`flex flex-1 flex-col gap-1 py-3 ${expanded ? "px-3" : "items-center px-0"}`}>
            {NAV.map((item) => {
              const active = item.match(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={expanded ? undefined : item.label}
                  className={`flex items-center rounded-lg text-sm font-medium transition ${
                    expanded ? "gap-2.5 px-3 py-2" : "h-9 w-9 justify-center"
                  } ${
                    active
                      ? "bg-white/15 text-white"
                      : "text-brand-100 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {expanded ? <span className="truncate whitespace-nowrap">{item.label}</span> : null}
                </Link>
              );
            })}
          </nav>
          <div className={`border-t border-white/10 py-3 ${expanded ? "px-3" : "flex justify-center px-0"}`}>
            <button
              type="button"
              onClick={logout}
              title={expanded ? undefined : "Log out"}
              aria-label="Log out"
              className={`flex items-center justify-center gap-2 rounded-md border border-white/25 bg-white/10 text-sm font-medium text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 ${
                expanded ? "w-full px-4 py-2" : "h-9 w-9"
              }`}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5M20 12H9M12 21H5a2 2 0 01-2-2V5a2 2 0 012-2h7" />
              </svg>
              {expanded ? <span className="whitespace-nowrap">Log out</span> : null}
            </button>
          </div>
        </aside>
      </div>
      <main className="min-w-0 flex-1 overflow-auto">
        {/* The OMS Courier account pages are the store admin's own
            integration screens (tables, tabs) - give them the width they
            were built for. */}
        <div
          className={`mx-auto px-6 py-8 ${
            isWidePage(pathname) ? "max-w-7xl" : "max-w-5xl"
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
