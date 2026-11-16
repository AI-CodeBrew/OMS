"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ProtectedRoute from "../../components/shared/ProtectedRoute";
import authService from "../../services/authService";
import useAuthStore from "../../store/authStore";
import { invalidateViewCache } from "../../lib/viewCache";
import { useScrollMemory } from "../../lib/pageMemory";
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
  GearIcon,
  AlertIcon,
} from "../../components/layout/navIcons";
import adminTeamService from "../../services/adminTeamService";

const NAV = [
  {
    href: "/admin/organizations",
    page: "organizations",
    label: "Organizations",
    icon: LayersIcon,
    match: (path) => path.startsWith("/admin/organizations") || path === "/admin",
  },
  {
    href: "/admin/stores",
    page: "stores",
    label: "Stores",
    icon: ShopBagIcon,
    match: (path) => path.startsWith("/admin/stores"),
  },
  {
    href: "/admin/all-orders",
    page: "all_orders",
    label: "All Orders",
    icon: ReceiptIcon,
    match: (path) => path.startsWith("/admin/all-orders"),
  },
  {
    // Every store's critical orders in one place (opens straight in).
    href: "/admin/critical-orders",
    page: "critical_orders",
    label: "Critical Orders",
    icon: AlertIcon,
    match: (path) => path.startsWith("/admin/critical-orders"),
  },
  {
    href: "/admin/dispatch-hub",
    page: "dispatch_hub",
    label: "Dispatch Hub",
    icon: TruckIcon,
    match: (path) => path.startsWith("/admin/dispatch-hub"),
  },
  {
    href: "/admin/inventory",
    page: "inventory",
    label: "Inventory",
    icon: PackageIcon,
    match: (path) => path.startsWith("/admin/inventory"),
  },
  {
    href: "/admin/invoices",
    page: "invoices",
    label: "Invoices",
    icon: CardIcon,
    match: (path) => path.startsWith("/admin/invoices"),
  },
  {
    href: "/admin/integrations",
    page: "integrations",
    label: "Integrations",
    icon: IntegrationsIcon,
    match: (path) => path.startsWith("/admin/integrations"),
  },
  {
    href: "/admin/oms-courier",
    page: "oms_courier",
    label: "OMS Couriers",
    icon: LinkIcon,
    match: (path) => path.startsWith("/admin/oms-courier") || path.startsWith("/admin/smartlane"),
  },
  {
    href: "/admin/logs",
    page: "logs",
    label: "Logs",
    icon: HistoryIcon,
    match: (path) => path.startsWith("/admin/logs"),
  },
  {
    href: "/admin/tickets",
    page: "tickets",
    label: "Tickets",
    icon: TicketIcon,
    match: (path) => path.startsWith("/admin/tickets"),
  },
  {
    href: "/admin/cities",
    page: "cities",
    label: "Cities",
    icon: GridIcon,
    match: (path) => path.startsWith("/admin/cities"),
  },
];

// Owners only: the super admin side's own staff logins and roles.
const ADMIN_TEAM_ITEM = {
  href: "/admin/team",
  page: "admin_team",
  label: "Admin Team",
  icon: GearIcon,
  match: (path) => path.startsWith("/admin/team"),
};

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
  // This login's super admin access (backend core.admin_pages): an owner
  // has every page; a staff login only the pages its role gives.
  const [access, setAccess] = useState(null);
  useEffect(() => {
    let alive = true;
    adminTeamService
      .me()
      .then((data) => alive && setAccess({ isOwner: data.is_owner, permissions: data.permissions || {} }))
      // Couldn't tell (e.g. a backend without this yet): show everything -
      // the backend still refuses whatever this login may not do.
      .catch(() => alive && setAccess({ isOwner: true, permissions: {}, failed: true }));
    return () => {
      alive = false;
    };
  }, []);
  const nav = access
    ? [
        ...NAV.filter(
          (item) =>
            access.isOwner ||
            access.permissions[item.page] ||
            // Pages inside the Hub also open the Dispatch Hub item.
            (item.page === "dispatch_hub" && Object.keys(access.permissions).some((k) => k.startsWith("hub.")))
        ),
        ...(access.isOwner ? [ADMIN_TEAM_ITEM] : []),
      ]
    : [];
  const currentItem = [...NAV, ADMIN_TEAM_ITEM].find((item) => item.match(pathname));
  const allowed = !access || !currentItem || nav.some((item) => item.href === currentItem.href);
  const readOnly =
    access && !access.isOwner && currentItem && access.permissions[currentItem.page] === "read";

  // A staff login landing on a page it can't open goes to its first page.
  useEffect(() => {
    if (!access || allowed || !nav.length) return;
    router.replace(nav[0].href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, allowed, pathname]);
  // Back/Forward lands where the page was scrolled to (lib/pageMemory).
  const [mainEl, setMainEl] = useState(null);
  useScrollMemory(mainEl);

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
            {nav.map((item) => {
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
      <main ref={setMainEl} className="min-w-0 flex-1 overflow-auto">
        {/* The OMS Courier account pages are the store admin's own
            integration screens (tables, tabs) - give them the width they
            were built for. */}
        <div
          className={`mx-auto px-6 py-8 ${
            isWidePage(pathname) ? "max-w-7xl" : "max-w-5xl"
          }`}
        >
          {readOnly ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Read only - you can look at this page but not change anything here.
            </p>
          ) : null}
          {!access ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : allowed ? (
            children
          ) : (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {nav.length
                ? "You don't have access to this page."
                : "Your login has no super admin pages yet - ask an owner to give you a role."}
            </p>
          )}
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
