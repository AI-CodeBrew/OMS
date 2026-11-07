// Single source of truth for the header's module switcher and every
// module's contextual sidebar. HEADER = which system am I in; SIDEBAR =
// what can I do inside it.

import {
  DashboardIcon,
  GridIcon,
  PackageIcon,
  UndoIcon,
  GearIcon,
  SwapIcon,
  HandIcon,
  ArrowDownBoxIcon,
  BarChartIcon,
  CardIcon,
  DocumentIcon,
  WalletIcon,
  CashIcon,
  IntegrationsIcon,
  LayersIcon,
  TicketIcon,
  AlertIcon,
} from "./navIcons";

// Top header tabs only — Integrations / Logs / Settings live in the sidebar.
export const MODULES = [
  { key: "oms", label: "OMS", href: "/dashboard" },
  { key: "ims", label: "IMS", href: "/ims/inventory" },
  { key: "wms", label: "WMS", href: "/wms/packing" },
  { key: "finance", label: "Financify", href: "/finance" },
];

export const STAFF_MODULE_OPTIONS = [
  { key: "oms", label: "OMS" },
  { key: "ims", label: "IMS" },
  { key: "wms", label: "WMS" },
  { key: "finance", label: "Financify" },
  // A WMS role rather than a module of its own: Returns Desk + Packing
  // only. Exclusive - never combined with the other options.
  { key: "returns", label: "Returns Associate", hint: "WMS · Returns Desk & Packing only", exclusive: true },
];

export const RETURNS_ASSOCIATE = "returns";

// Role pages (backend: core/pages.py - the same keys): which page each
// address belongs to. A staff login with a role (user.pages, from
// /api/core/me/access/) sees and opens only the pages it has.
const PATH_PAGES = [
  ["/dashboard", "oms.dashboard"],
  ["/orders", "oms.orders"],
  ["/critical-orders", "oms.critical_orders"],
  ["/ims/inventory", "ims.inventory"],
  ["/ims/purchase-orders", "ims.purchase_orders"],
  ["/wms/packing", "wms.packing"],
  ["/returns", "wms.returns_desk"],
  ["/finance", "finance.home"],
  ["/reports", "reports"],
  ["/batch", "batch"],
  ["/tickets", "tickets"],
];

export function pageForPath(pathname) {
  const hit = PATH_PAGES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : null;
}

function isAdminUser(user) {
  return user?.role === "org_admin" || user?.isOrgAdmin === true || user?.role === "super_admin";
}

/** Staff whose access is per page (a role, or old modules turned into
 * pages by the backend). Admins and the Dispatch Hub aren't limited. */
export function hasPageLimits(user) {
  return Boolean(user && !user.isDispatchHub && !isAdminUser(user) && user.pages && typeof user.pages === "object");
}

export function canReadPage(user, pageKey) {
  if (!hasPageLimits(user)) return true;
  const level = user.pages[pageKey];
  return level === "read" || level === "write";
}

export function canWritePage(user, pageKey) {
  if (!hasPageLimits(user)) return true;
  return user.pages[pageKey] === "write";
}

// Staff whose only role is Returns Associate. Admins never are.
export function isReturnsAssociate(user) {
  if (!user || user.isDispatchHub) return false;
  // With per-page access the generic rules below already narrow it down.
  if (hasPageLimits(user)) return false;
  const isAdmin = user.role === "org_admin" || user.isOrgAdmin || user.role === "super_admin";
  const modules = Array.isArray(user.modules) ? user.modules : [];
  return !isAdmin && modules.includes(RETURNS_ASSOCIATE);
}

const RETURNS_ASSOCIATE_PREFIXES = ["/returns", "/wms/packing", "/settings"];

// Pinned at the bottom of the sidebar regardless of active module.
export const SETTINGS_ITEM = {
  key: "settings",
  label: "Settings",
  href: "/settings",
  icon: GearIcon,
};

export const INTEGRATIONS_ITEM = {
  key: "integrations",
  label: "Integrations",
  href: "/integrations",
  icon: IntegrationsIcon,
};

// Invoices FynkTech issues for dispatching this store's orders, plus the
// bank details FynkTech remits COD to - distinct from the disabled
// "Invoices" stub under the (not-yet-built) Financify module above.
export const BILLING_ITEM = {
  key: "billing",
  label: "Invoices",
  href: "/billing",
  icon: WalletIcon,
};

export const LOGS_ITEM = {
  key: "logs",
  label: "Logs",
  href: "/logs",
  icon: DocumentIcon,
};

export const REPORT_ITEM = {
  key: "reports",
  label: "Report",
  href: "/reports",
  icon: BarChartIcon,
  page: "reports",
};

export const BATCH_ITEM = {
  key: "batch",
  label: "Batch",
  href: "/batch",
  icon: LayersIcon,
  page: "batch",
};

// Every tenant user (not just org admins) can see their own tickets - the
// only bottom-block item with that reach, so it gets its own unconditional
// allow in canAccessPath below rather than the hasProduct()/isAdmin gates
// every other item there uses.
export const TICKETS_ITEM = {
  key: "tickets",
  label: "Tickets",
  href: "/tickets",
  icon: TicketIcon,
  page: "tickets",
};

const MODULE_PATH_PREFIXES = {
  oms: ["/orders", "/dashboard", "/critical-orders"],
  ims: ["/ims"],
  // Returns Desk lives under WMS — keep the WMS sidebar when on /returns.
  wms: ["/wms", "/returns"],
  finance: ["/finance"],
  integrations: ["/integrations"],
  billing: ["/billing"],
  logs: ["/logs"],
  reports: ["/reports"],
  batch: ["/batch"],
  settings: ["/settings"],
  tickets: ["/tickets"],
};

export function getActiveModule(pathname) {
  const match = Object.entries(MODULE_PATH_PREFIXES).find(([, prefixes]) =>
    prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
  return match ? match[0] : null;
}

// Operating the Dispatch Hub spans several stores at once, so the usual
// module-tab model (OMS/WMS/Financify, each its own store-shaped world)
// doesn't apply - one fixed set of pages instead, none of them WMS
// inventory/Settings/Integrations/Billing (all genuinely single-store).
const HUB_ALLOWED_PREFIXES = [
  "/dashboard", "/orders", "/critical-orders", "/returns", "/reports", "/batch", "/tickets",
];

/** Header tabs visible for the current user (JWT modules + org-admin gates). */
export function getVisibleModules(user) {
  if (!user) return [];
  if (user.isDispatchHub) {
    return [{ key: "oms", label: user.isAllOrders ? "All Orders" : "Dispatch Hub", href: "/dashboard" }];
  }
  if (isReturnsAssociate(user)) {
    return [{ key: "wms", label: "WMS", href: "/returns" }];
  }
  if (hasPageLimits(user)) {
    // A tab for every module with at least one page the role opens -
    // landing on the first of them.
    return MODULES.map((m) => {
      const first = (SIDEBAR_ITEMS[m.key] || []).find(
        (item) => item.page && !item.disabled && canReadPage(user, item.page)
      );
      return first ? { ...m, href: first.href } : null;
    }).filter(Boolean);
  }
  const isAdmin = user.role === "org_admin" || user.isOrgAdmin || user.role === "super_admin";
  const modules = Array.isArray(user.modules) ? user.modules : [];
  const hasProduct = (key) => {
    if (isAdmin) {
      return modules.length ? modules.includes(key) : true;
    }
    return modules.includes(key);
  };

  return MODULES.filter((m) => hasProduct(m.key));
}

/** First allowed module home for redirects when staff hit a forbidden route. */
export function getDefaultModuleHref(user) {
  const visible = getVisibleModules(user);
  if (visible.length) return visible[0].href;
  if (hasPageLimits(user)) {
    const general = [REPORT_ITEM, BATCH_ITEM, TICKETS_ITEM].find((item) => canReadPage(user, item.page));
    if (general) return general.href;
  }
  return "/settings";
}

export function canAccessPath(user, pathname) {
  if (!user) return false;
  if (user.isDispatchHub) {
    return HUB_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  if (isReturnsAssociate(user)) {
    return RETURNS_ASSOCIATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return true;
  if (hasPageLimits(user)) {
    // Old Inventory / PO addresses just redirect into IMS.
    if (pathname === "/wms" || pathname === "/wms/purchase-orders" || pathname === "/ims") return true;
    const page = pageForPath(pathname);
    if (page) return canReadPage(user, page);
    // Integrations, Invoices, Logs: store admin only.
    return !["/integrations", "/billing", "/logs"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  if (pathname === "/tickets" || pathname.startsWith("/tickets/")) return true;

  const isAdmin = user.role === "org_admin" || user.isOrgAdmin || user.role === "super_admin";
  const modules = Array.isArray(user.modules) ? user.modules : [];
  const hasProduct = (key) => {
    if (isAdmin) return modules.length ? modules.includes(key) : true;
    return modules.includes(key);
  };

  if (pathname === "/logs" || pathname.startsWith("/logs/")) return isAdmin;
  if (pathname === "/integrations" || pathname.startsWith("/integrations/")) return isAdmin;
  if (pathname === "/billing" || pathname.startsWith("/billing/")) return isAdmin;
  if (pathname === "/returns" || pathname.startsWith("/returns/")) {
    return hasProduct("oms") || hasProduct("wms");
  }
  if (pathname === "/reports" || pathname.startsWith("/reports/")) {
    return hasProduct("oms") || hasProduct("wms");
  }
  if (pathname === "/batch" || pathname.startsWith("/batch/")) {
    return hasProduct("oms") || hasProduct("wms");
  }

  const active = getActiveModule(pathname);
  if (!active) return true;
  return getVisibleModules(user).some((m) => m.key === active);
}

// Sidebar items with no real page behind them yet are marked disabled -
// same "visible but not wired up" convention used elsewhere in this app
// rather than linking to a dead end.
export const SIDEBAR_ITEMS = {
  oms: [
    { label: "Dashboard", href: "/dashboard", icon: DashboardIcon, page: "oms.dashboard" },
    { label: "All Orders", href: "/orders", icon: GridIcon, page: "oms.orders" },
    { label: "Critical Orders", href: "/critical-orders", icon: AlertIcon, page: "oms.critical_orders" },
  ],
  // IMS - Inventory Management (moved out of WMS).
  ims: [
    { label: "Inventory", href: "/ims/inventory", icon: PackageIcon, page: "ims.inventory" },
    { label: "Purchase Orders", href: "/ims/purchase-orders", icon: DocumentIcon, page: "ims.purchase_orders" },
  ],
  wms: [
    { label: "Packing", href: "/wms/packing", icon: PackageIcon, page: "wms.packing" },
    { label: "Returns Desk", href: "/returns", icon: UndoIcon, page: "wms.returns_desk" },
    { divider: true },
    { label: "Stock Transfers", disabled: true, icon: SwapIcon },
    { label: "Picking", disabled: true, icon: HandIcon },
    { label: "Putaway", disabled: true, icon: ArrowDownBoxIcon },
    { label: "Reports", disabled: true, icon: BarChartIcon },
  ],
  finance: [
    { label: "Financify", href: "/finance", icon: GridIcon, page: "finance.home", hidden: true },
    { label: "Dashboard", disabled: true, icon: GridIcon },
    { label: "Transactions", disabled: true, icon: SwapIcon },
    { label: "Payments", disabled: true, icon: CardIcon },
    { label: "COD Reconciliation", disabled: true, icon: CashIcon },
    { label: "Invoices", disabled: true, icon: DocumentIcon },
    { label: "Refunds", disabled: true, icon: UndoIcon },
    { label: "Expenses", disabled: true, icon: WalletIcon },
    { divider: true },
    { label: "Reports", disabled: true, icon: BarChartIcon },
  ],
  integrations: [],
  billing: [],
  logs: [],
  reports: [],
  batch: [],
  settings: [],
  tickets: [],
};

// The Dispatch Hub's own sidebar - same pages as the oms/wms ones above,
// minus anything genuinely single-store (WMS inventory/packing, the
// disabled Financify stubs). Used instead of SIDEBAR_ITEMS[activeModule]
// whenever user.isDispatchHub (see ModuleSidebar).
// A Returns Associate's whole sidebar (see ModuleSidebar), in place of
// SIDEBAR_ITEMS.wms - Inventory and the rest of WMS stay off-limits.
export const RETURNS_ASSOCIATE_SIDEBAR_ITEMS = [
  { label: "Returns Desk", href: "/returns", icon: UndoIcon },
  { label: "Packing", href: "/wms/packing", icon: PackageIcon },
];

export const HUB_SIDEBAR_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
  { label: "All Orders", href: "/orders", icon: GridIcon },
  { label: "Critical Orders", href: "/critical-orders", icon: AlertIcon },
  { label: "Returns Desk", href: "/returns", icon: UndoIcon },
];
