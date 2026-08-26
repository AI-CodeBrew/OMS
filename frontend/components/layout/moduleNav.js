// Single source of truth for the header's module switcher and every
// module's contextual sidebar. HEADER = which system am I in; SIDEBAR =
// what can I do inside it.

import {
  DashboardIcon,
  ReceiptIcon,
  GridIcon,
  ClockIcon,
  CashIcon,
  CheckCircleIcon,
  PackageIcon,
  TruckIcon,
  UndoIcon,
  GearIcon,
  SwapIcon,
  HandIcon,
  ArrowDownBoxIcon,
  BarChartIcon,
  CardIcon,
  DocumentIcon,
  WalletIcon,
  ShopBagIcon,
  LinkIcon,
} from "./navIcons";

export const MODULES = [
  { key: "oms", label: "OMS", href: "/dashboard" },
  { key: "wms", label: "WMS", href: "/wms" },
  { key: "finance", label: "Finance", href: "/finance" },
  { key: "integrations", label: "Integrations", href: "/integrations" },
  { key: "returns", label: "Returns", href: "/returns" },
  { key: "reports", label: "Reports", href: "/reports" },
];

// Pinned at the bottom of the sidebar regardless of active module, rather
// than living in the header nav - settings isn't really "a module" you
// switch into, it's always-available account config.
export const SETTINGS_ITEM = { key: "settings", label: "Settings", href: "/settings", icon: GearIcon };

const MODULE_PATH_PREFIXES = {
  oms: ["/orders", "/dashboard"],
  wms: ["/wms"],
  finance: ["/finance"],
  integrations: ["/integrations"],
  returns: ["/returns"],
  reports: ["/reports"],
  settings: ["/settings"],
};

export function getActiveModule(pathname) {
  const match = Object.entries(MODULE_PATH_PREFIXES).find(([, prefixes]) =>
    prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
  return match ? match[0] : null;
}

// Sidebar items with no real page behind them yet are marked disabled -
// same "visible but not wired up" convention used elsewhere in this app
// (IVR Call, Download Invoices, ...) rather than linking to a dead end.
export const SIDEBAR_ITEMS = {
  oms: [
    { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
    { label: "Local Orders", href: "/orders", icon: ReceiptIcon },
    { label: "All Orders", href: "/orders", icon: GridIcon },
    { label: "Pending Orders", href: "/orders?status=pending_cc,pending_cod", icon: ClockIcon },
    { label: "Pending COD", href: "/orders?status=pending_cod", icon: CashIcon },
    { label: "Awaiting Approval", href: "/orders?status=awaiting_approval", icon: CheckCircleIcon },
    { label: "Awaiting Dispatch", href: "/orders?status=awaiting_dispatched", icon: PackageIcon },
    { label: "Dispatched", href: "/orders?status=dispatched", icon: TruckIcon },
    { label: "Returns", href: "/orders?status=returned", icon: UndoIcon },
  ],
  wms: [
    { label: "Inventory", href: "/wms", icon: PackageIcon },
    { label: "Returns Desk", href: "/returns", icon: UndoIcon },
    { divider: true },
    { label: "Stock Transfers", disabled: true, icon: SwapIcon },
    { label: "Picking", disabled: true, icon: HandIcon },
    { label: "Packing", disabled: true, icon: PackageIcon },
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
  returns: [
    { label: "Returned Orders", href: "/returns", icon: UndoIcon },
    { label: "Inventory", href: "/wms", icon: PackageIcon },
  ],
  integrations: [
    { label: "Connectivity", href: "/integrations", icon: LinkIcon },
    { label: "Shopify", href: "/integrations/shopify", icon: ShopBagIcon },
    { label: "Smartlane", href: "/integrations/smartlane", icon: TruckIcon },
    { label: "Leopard Courier", disabled: true, icon: PackageIcon },
    { label: "PostEx", disabled: true, icon: PackageIcon },
  ],
  reports: [],
  settings: [],
};
