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
} from "./navIcons";

// Top header tabs only — Integrations / Logs / Settings live in the sidebar.
export const MODULES = [
  { key: "oms", label: "OMS", href: "/dashboard" },
  { key: "wms", label: "WMS", href: "/wms" },
  { key: "finance", label: "Financify", href: "/finance" },
];

export const STAFF_MODULE_OPTIONS = [
  { key: "oms", label: "OMS" },
  { key: "wms", label: "WMS" },
  { key: "finance", label: "Financify" },
];

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
};

export const BATCH_ITEM = {
  key: "batch",
  label: "Batch",
  href: "/batch",
  icon: LayersIcon,
};

const MODULE_PATH_PREFIXES = {
  oms: ["/orders", "/dashboard"],
  // Returns Desk lives under WMS — keep the WMS sidebar when on /returns.
  wms: ["/wms", "/returns"],
  finance: ["/finance"],
  integrations: ["/integrations"],
  logs: ["/logs"],
  reports: ["/reports"],
  batch: ["/batch"],
  settings: ["/settings"],
};

export function getActiveModule(pathname) {
  const match = Object.entries(MODULE_PATH_PREFIXES).find(([, prefixes]) =>
    prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
  return match ? match[0] : null;
}

/** Header tabs visible for the current user (JWT modules + org-admin gates). */
export function getVisibleModules(user) {
  if (!user) return [];
  const isAdmin = user.role === "org_admin" || user.isOrgAdmin || user.role === "super_admin";
  const modules = Array.isArray(user.modules) ? user.modules : [];
  const hasProduct = (key) => {
    if (isAdmin) {
      return modules.length ? modules.includes(key) : true;
    }
    return modules.includes(key);
  };

  return MODULES.filter((m) => {
    if (m.key === "oms" || m.key === "wms" || m.key === "finance") return hasProduct(m.key);
    return false;
  });
}

/** First allowed module home for redirects when staff hit a forbidden route. */
export function getDefaultModuleHref(user) {
  const visible = getVisibleModules(user);
  if (visible.length) return visible[0].href;
  return "/settings";
}

export function canAccessPath(user, pathname) {
  if (!user) return false;
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return true;

  const isAdmin = user.role === "org_admin" || user.isOrgAdmin || user.role === "super_admin";
  const modules = Array.isArray(user.modules) ? user.modules : [];
  const hasProduct = (key) => {
    if (isAdmin) return modules.length ? modules.includes(key) : true;
    return modules.includes(key);
  };

  if (pathname === "/logs" || pathname.startsWith("/logs/")) return isAdmin;
  if (pathname === "/integrations" || pathname.startsWith("/integrations/")) return isAdmin;
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
    { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
    { label: "All Orders", href: "/orders", icon: GridIcon },
  ],
  wms: [
    { label: "Inventory", href: "/wms", icon: PackageIcon },
    { label: "Packing", href: "/wms/packing", icon: PackageIcon },
    { label: "Returns Desk", href: "/returns", icon: UndoIcon },
    { divider: true },
    { label: "Stock Transfers", disabled: true, icon: SwapIcon },
    { label: "Picking", disabled: true, icon: HandIcon },
    { label: "Putaway", disabled: true, icon: ArrowDownBoxIcon },
    { label: "Reports", disabled: true, icon: BarChartIcon },
  ],
  finance: [
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
  logs: [],
  reports: [],
  batch: [],
  settings: [],
};
