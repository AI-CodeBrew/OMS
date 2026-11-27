"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Dropdown from "../shared/Dropdown";
import StoreSwitcher from "./StoreSwitcher";
import NotificationBell from "./NotificationBell";
import authService from "../../services/authService";
import useAuthStore, { useEffectiveUser } from "../../store/authStore";
import useCriticalOrdersStore from "../../store/criticalOrdersStore";
import { getVisibleModules } from "./moduleNav";
import BrandLogo from "../shared/BrandLogo";

function ChevronIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BackArrowIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M12.5 15 7.5 10l5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TenantHeader({ activeModule }) {
  const router = useRouter();
  const user = useEffectiveUser();
  // The Dispatch Hub / All Orders has just one "module" - its name already
  // shows on the right (StoreSwitcher), so no tab in the middle for it.
  const modules = user?.isDispatchHub ? [] : getVisibleModules(user);
  const criticalCount = useCriticalOrdersStore((s) => s.count);
  const activeModuleLabel = modules.find((m) => m.key === activeModule)?.label || "Menu";
  // A super admin inside a store or the Dispatch Hub: the back arrow is the
  // way back out to the admin panel.
  const actingStore = useAuthStore((s) => s.actingStore);
  const exitLabel = actingStore?.critical
    ? "Exit Critical Orders"
    : actingStore?.allStores
    ? "Exit All Orders"
    : actingStore?.hub
      ? "Exit Dispatch Hub"
      : "Exit store";

  function exitActingStore() {
    // All Orders goes back to the admin panel's first page - its own tab
    // would only open All Orders again.
    const target =
      actingStore?.exitTo ||
      // The Hub opens straight in now - going back to its tab would only
      // open it again (user, 2026-11-26).
      (actingStore?.allStores || actingStore?.hub ? "/admin/organizations" : "/admin/stores");
    // Only navigates: the admin panel's layout leaves the store as it opens.
    // Leaving it here first left this page with no store for a moment, and
    // the page's own guard then raced off to Stores (user, 2026-11-24).
    router.push(target);
  }

  function logout() {
    authService.logout();
    router.replace(user?.role === "super_admin" ? "/superadmin" : "/login");
  }

  return (
    <header className="sticky top-0 z-40 bg-brand-800">
      {/* px-3 + shrinking gaps below md, back to the roomier desktop
          layout at md+ - the old fixed 3-column grid with unwrapped module
          tabs and a full email address had no minimum width it could
          shrink to, so on a phone the whole header (and everything
          sticky/relative to it) forced the page wider than the viewport
          instead of just wrapping. */}
      <div className="flex h-16 items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-1.5">
          {/* A Hub-only staff login has nowhere else to go - no back arrow. */}
          {actingStore && actingStore.exitTo !== null ? (
            <button
              type="button"
              onClick={exitActingStore}
              title={exitLabel}
              aria-label={exitLabel}
              className="-ml-1 rounded-md p-1.5 text-white transition hover:bg-white/15"
            >
              <BackArrowIcon className="h-5 w-5" />
            </button>
          ) : null}
          <BrandLogo className="h-8 w-8 ring-1 ring-white/25" alt="" />
          <span className="text-lg font-bold tracking-tight text-white">OMS</span>
        </div>

        {/* Desktop: every module as its own tab. Below md that's replaced
            by the compact dropdown underneath - same items, same
            destinations, just collapsed into one trigger instead of N
            unwrapped links. */}
        <nav className="hidden items-center gap-1 text-sm md:flex">
          {modules.map((m) => {
            const isActive = m.key === activeModule;
            return (
              <Link
                key={m.key}
                href={m.href}
                className={`whitespace-nowrap rounded-md border-b-2 px-3 py-2 font-medium transition ${
                  isActive
                    ? "border-white bg-white/15 text-white"
                    : "border-transparent text-brand-100 hover:bg-white/10 hover:text-white"
                }`}
              >
                {m.label}
              </Link>
            );
          })}
        </nav>

        <div className={modules.length ? "md:hidden" : "hidden"}>
          <Dropdown
            trigger={
              <span className="flex items-center gap-1 rounded-md border-b-2 border-white bg-white/15 px-2.5 py-1.5 text-sm font-medium text-white">
                {activeModuleLabel}
                <ChevronIcon className="h-4 w-4 text-brand-100" />
              </span>
            }
            items={modules.map((m) => ({
              key: m.key,
              label: m.label,
              onClick: () => router.push(m.href),
            }))}
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-4">
          <StoreSwitcher />

          <NotificationBell
            criticalCount={criticalCount}
            canMarkRead={user?.role !== "super_admin"}
          />

          <Dropdown
            align="right"
            trigger={
              <span className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-white hover:bg-white/10">
                {/* Full address only where there's room for it - below sm
                    it would alone be wider than most phones, so the
                    dropdown (which still shows it in full) is the only
                    place it appears there. */}
                <span className="hidden max-w-[12rem] truncate sm:inline">{user?.email}</span>
                <ChevronIcon className="h-4 w-4 text-brand-100" />
              </span>
            }
            items={[
              { key: "email", label: user?.email || "", disabled: true },
              { key: "divider-email", divider: true },
              { key: "settings", label: "Settings", onClick: () => router.push("/settings") },
              { key: "divider", divider: true },
              { key: "logout", label: "Log out", onClick: logout },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
