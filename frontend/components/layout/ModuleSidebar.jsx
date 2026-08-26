"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SIDEBAR_ITEMS, SETTINGS_ITEM } from "./moduleNav";

function isItemActive(item, pathname, search) {
  if (!item.href) return false;
  const [itemPath, itemQuery] = item.href.split("?");
  if (itemPath !== pathname) return false;
  if (!itemQuery) return !search.toString(); // "All Orders"/"Local Orders" only active with no filter
  const itemParams = new URLSearchParams(itemQuery);
  return itemParams.get("status") === (search.get("status") || "");
}

function RailTooltip({ label, disabled }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-md bg-brand-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
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

const MenuGlyph = ({ className }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <path d="M2.5 5h15M2.5 10h15M2.5 15h15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// Same static look as every other item (muted, hover-highlight only - no
// permanent "active" color just because the sidebar happens to be
// expanded right now), and it mirrors RailIcon/FullLink's own two modes:
// icon-only + hover tooltip when collapsed, icon + visible label when
// expanded - so it reads as "just another row," not a special control.
function MenuToggle({ expanded, onToggle }) {
  if (expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Collapse sidebar"
        className="mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-100 transition hover:bg-white/10 hover:text-white"
      >
        <MenuGlyph className="h-5 w-5 shrink-0" />
        <span>Menu</span>
      </button>
    );
  }

  return (
    <div className="group relative mb-2 flex justify-center">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Expand sidebar"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-100 transition hover:bg-white/10 hover:text-white"
      >
        <MenuGlyph className="h-5 w-5" />
      </button>
      <RailTooltip label="Menu" />
    </div>
  );
}

export default function ModuleSidebar({ activeModule, expanded, onToggle }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const items = SIDEBAR_ITEMS[activeModule] || [];
  const ItemComponent = expanded ? FullLink : RailIcon;
  const asideRef = useRef(null);

  useEffect(() => {
    if (!expanded) return undefined;
    function onClickOutside(e) {
      if (asideRef.current && !asideRef.current.contains(e.target)) onToggle();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [expanded, onToggle]);

  return (
    <aside
      ref={asideRef}
      className={`sticky top-16 z-20 flex h-[calc(100vh-4rem)] shrink-0 flex-col border-r border-brand-900 bg-brand-800 py-4 transition-all duration-150 ${
        expanded ? "w-56 items-stretch px-3" : "w-14 items-center"
      }`}
    >
      <MenuToggle expanded={expanded} onToggle={onToggle} />

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

      <div className={`mt-2 border-t border-brand-900 pt-2 ${expanded ? "" : "w-full"}`}>
        <ItemComponent item={SETTINGS_ITEM} active={pathname === SETTINGS_ITEM.href} />
      </div>
    </aside>
  );
}
