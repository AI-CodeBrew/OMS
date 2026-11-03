"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  SIDEBAR_ITEMS,
  HUB_SIDEBAR_ITEMS,
  RETURNS_ASSOCIATE_SIDEBAR_ITEMS,
  isReturnsAssociate,
  SETTINGS_ITEM,
  LOGS_ITEM,
  INTEGRATIONS_ITEM,
  BILLING_ITEM,
  REPORT_ITEM,
  BATCH_ITEM,
  TICKETS_ITEM,
} from "./moduleNav";
import { useEffectiveUser } from "../../store/authStore";

function isItemActive(item, pathname, search) {
  if (!item.href) return false;
  const [itemPath, itemQuery] = item.href.split("?");
  if (itemPath !== pathname) return false;
  if (!itemQuery) {
    // Path-only links (Inventory, Returns Desk, All Orders): active when
    // on that path, regardless of unrelated query params.
    return true;
  }
  const itemParams = new URLSearchParams(itemQuery);
  return itemParams.get("status") === (search.get("status") || "");
}

function RailTooltip({ label, disabled }) {
  // Touch devices have no hover state to reveal this, so below md it's
  // dropped from the DOM entirely rather than just left invisible -
  // opacity-0 still leaves an absolutely-positioned, whitespace-nowrap
  // box contributing to the page's real scrollable width, which is what
  // was dragging Returns/Packing (and every other page) sideways on
  // mobile even after their own tables were fixed.
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-md bg-brand-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 md:block"
    >
      {label}
      {disabled ? <span className="ml-1 text-brand-300">· soon</span> : null}
    </span>
  );
}

function RailIcon({ item, active }) {
  const Icon = item.icon;
  const disabled = item.disabled;

  const iconBox = (
    <span
      className={`flex h-9 w-9 items-center justify-center rounded-lg border-b-2 transition ${
        disabled
          ? "cursor-not-allowed border-transparent text-white/30"
          : active
            ? "border-white bg-white/15 text-white"
            : "border-transparent text-brand-100 hover:bg-white/10 hover:text-white"
      }`}
    >
      {Icon ? <Icon className="h-5 w-5" /> : null}
    </span>
  );

  return (
    <div className="group relative flex justify-center">
      {disabled ? iconBox : <Link href={item.href}>{iconBox}</Link>}
      <RailTooltip label={item.label} disabled={disabled} />
    </div>
  );
}

function FullLink({ item, active }) {
  const Icon = item.icon;
  const disabled = item.disabled;
  const content = (
    <>
      {Icon ? <Icon className="h-5 w-5 shrink-0" /> : null}
      <span className="truncate">{item.label}</span>
      {disabled ? <span className="ml-auto shrink-0 text-xs text-white/40">soon</span> : null}
    </>
  );
  const className = `flex items-center gap-2.5 rounded-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
    disabled
      ? "cursor-not-allowed border-transparent text-white/30"
      : active
        ? "border-white bg-white/15 text-white"
        : "border-transparent text-brand-100 hover:bg-white/10 hover:text-white"
  }`;

  if (disabled) {
    return <span className={className}>{content}</span>;
  }
  return (
    <Link href={item.href} className={className}>
      {content}
    </Link>
  );
}

// One source for what the nav shows, so the desktop rail and the phone
// bar (MobileNav) can never list different pages.
function useNavItems(activeModule) {
  const user = useEffectiveUser();
  const isOrgAdmin =
    user?.role === "org_admin" || user?.isOrgAdmin === true || user?.role === "super_admin";
  const returnsAssociate = isReturnsAssociate(user);
  const items = user?.isDispatchHub
    ? HUB_SIDEBAR_ITEMS
    : returnsAssociate
      ? RETURNS_ASSOCIATE_SIDEBAR_ITEMS
      : SIDEBAR_ITEMS[activeModule] || [];
  const bottom = [
    ...(isOrgAdmin && !user?.isDispatchHub ? [INTEGRATIONS_ITEM, BILLING_ITEM, LOGS_ITEM] : []),
    ...(!returnsAssociate ? [REPORT_ITEM, BATCH_ITEM, TICKETS_ITEM] : []),
    ...(!user?.isDispatchHub ? [SETTINGS_ITEM] : []),
  ];
  return { items, bottom };
}

function isSectionActive(item, pathname) {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

// Expands while the pointer is over it (no Menu button) and folds back
// to the icon rail when it leaves. The rail's own width is held by an
// outer w-14 box, so the expanded panel slides over the page rather than
// pushing it sideways on every pass of the mouse.
export default function ModuleSidebar({ activeModule }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { items, bottom } = useNavItems(activeModule);
  const [expanded, setExpanded] = useState(false);
  const ItemComponent = expanded ? FullLink : RailIcon;

  // Leaving for another page shouldn't leave it open over the new one.
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  // Desktop only - below md the same links sit in MobileNav's bar under the
  // header instead, so a phone gets its full width for the page.
  return (
    <div className="relative z-30 hidden w-14 shrink-0 md:block">
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      // min-h, not h: a module with many links (Financify/WMS, expanded)
      // is taller than the screen, and a fixed height let the bottom links
      // spill out below the blue box onto the white page, near-invisible.
      // Growing instead keeps them on blue and reachable by scrolling.
      className={`sticky top-16 flex min-h-[calc(100vh-4rem)] flex-col border-r border-brand-900 bg-brand-800 py-4 transition-all duration-150 ${
        expanded ? "w-56 items-stretch px-3 shadow-2xl" : "w-14 items-center"
      }`}
    >
      <nav className={`flex-1 space-y-1 ${expanded ? "" : "w-full"}`}>
        {items.map((item, i) =>
          item.divider ? (
            <div
              key={`divider-${i}`}
              className={`my-2 h-px bg-brand-900 ${expanded ? "" : "mx-auto w-8"}`}
            />
          ) : (
            <ItemComponent key={item.label} item={item} active={isItemActive(item, pathname, search)} />
          )
        )}
      </nav>

      <div className={`mt-2 space-y-1 border-t border-brand-900 pt-2 ${expanded ? "" : "w-full"}`}>
        {bottom.map((item) => (
          <ItemComponent key={item.key} item={item} active={isSectionActive(item, pathname)} />
        ))}
      </div>
    </aside>
    </div>
  );
}

/** Phones (below md): the sidebar's links as one horizontally scrolling
 * row of pills under the header, in place of the blue rail. "Coming soon"
 * items are left out - there's no room to show a disabled stub here. */
export function MobileNav({ activeModule }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { items, bottom } = useNavItems(activeModule);
  const links = [
    ...items.filter((item) => !item.divider && !item.disabled).map((item) => ({
      item,
      active: isItemActive(item, pathname, search),
    })),
    ...bottom.map((item) => ({ item, active: isSectionActive(item, pathname) })),
  ];

  return (
    <nav className="sticky top-16 z-30 flex gap-1.5 overflow-x-auto border-b border-brand-900 bg-brand-800 px-3 pb-2 md:hidden">
      {links.map(({ item, active }) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active ? "bg-white text-brand-800" : "bg-white/10 text-brand-100 hover:bg-white/20"
            }`}
          >
            {Icon ? <Icon className="h-4 w-4" /> : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
