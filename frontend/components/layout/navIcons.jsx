"use client";

// Small, consistent line-icon set for the sidebar rail - 1.5 stroke, 20x20
// viewBox, matching the outline style already used elsewhere in this app
// (LayersIcon/ShieldIcon/BoltIcon/etc. in the integrations page, MenuIcon/
// BellIcon in the header).

function Base({ children, className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const ListIcon = ({ className }) => (
  <Base className={className}>
    <path d="M4 5.5h12M4 10h12M4 14.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Base>
);

// Distinct from ListIcon on purpose - used for "Local Orders" so it
// doesn't visually double as a second hamburger next to the sidebar's
// actual expand/collapse toggle.
export const ReceiptIcon = ({ className }) => (
  <Base className={className}>
    <path
      d="M5 2.5h10v15l-2-1.3-1.5 1.3-1.5-1.3-1.5 1.3L7 16.2l-2 1.3v-15Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Base>
);

export const GridIcon = ({ className }) => (
  <Base className={className}>
    <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
  </Base>
);

export const ClockIcon = ({ className }) => (
  <Base className={className}>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Base>
);

export const CashIcon = ({ className }) => (
  <Base className={className}>
    <rect x="2.5" y="5.5" width="15" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
  </Base>
);

export const CheckCircleIcon = ({ className }) => (
  <Base className={className}>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 10.2 9 12l4-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Base>
);

export const PackageIcon = ({ className }) => (
  <Base className={className}>
    <path d="M10 2.5 3 6v8l7 3.5 7-3.5V6l-7-3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M3 6l7 3.5M10 9.5 17 6M10 9.5v7.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </Base>
);

export const TruckIcon = ({ className }) => (
  <Base className={className}>
    <rect x="2" y="6" width="9" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M11 8.5h3.5L17 11v2h-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="6" cy="14.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="14" cy="14.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
  </Base>
);

export const UndoIcon = ({ className }) => (
  <Base className={className}>
    <path d="M5 8H12a4 4 0 0 1 0 8H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 4.5 5 8l3 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Base>
);

export const BookmarkIcon = ({ className }) => (
  <Base className={className}>
    <path d="M5.5 3.5h9v13l-4.5-3-4.5 3v-13Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </Base>
);

export const GearIcon = ({ className }) => (
  <Base className={className}>
    <path
      d="M11.07 2.5h-2.14l-.27 1.55a5.9 5.9 0 0 0-1.28.74L5.9 4.17 4.17 5.9l.62 1.48a5.9 5.9 0 0 0-.74 1.28L2.5 8.93v2.14l1.55.27c.18.46.43.9.74 1.28l-.62 1.48L5.9 15.83l1.48-.62c.38.31.82.56 1.28.74l.27 1.55h2.14l.27-1.55c.46-.18.9-.43 1.28-.74l1.48.62 1.73-1.73-.62-1.48c.31-.38.56-.82.74-1.28l1.55-.27V8.93l-1.55-.27a5.9 5.9 0 0 0-.74-1.28l.62-1.48L14.1 4.17l-1.48.62a5.9 5.9 0 0 0-1.28-.74L11.07 2.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
  </Base>
);

export const WarehouseIcon = ({ className }) => (
  <Base className={className}>
    <path d="M2.5 8.5 10 3l7.5 5.5V17h-15V8.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.5 17v-5h5v5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </Base>
);

export const SwapIcon = ({ className }) => (
  <Base className={className}>
    <path d="M4 7h10.5L12 4.5M16 13H5.5L8 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Base>
);

export const HandIcon = ({ className }) => (
  <Base className={className}>
    <path
      d="M7 9V4.5a1.2 1.2 0 0 1 2.4 0V9m0-.5V3.7a1.2 1.2 0 0 1 2.4 0V9m0-.3a1.2 1.2 0 0 1 2.4 0V10m0 0V9a1.2 1.2 0 0 1 2.2-.7c.4.5.5 1 .5 2.2 0 3-1.5 6-5.5 6-3 0-4-1-5.5-3l-1.6-2.4a1.1 1.1 0 0 1 1.7-1.4L7 11"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Base>
);

export const ArrowDownBoxIcon = ({ className }) => (
  <Base className={className}>
    <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 6.5v6M7 10l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Base>
);

export const SlidersIcon = ({ className }) => (
  <Base className={className}>
    <path d="M4 5h12M4 10h12M4 15h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="5" r="1.5" fill="white" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="13" cy="10" r="1.5" fill="white" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="7" cy="15" r="1.5" fill="white" stroke="currentColor" strokeWidth="1.5" />
  </Base>
);

// Speedometer glyph - distinct from BarChartIcon (used for the disabled
// "Reports" stub elsewhere) so the real, built Dashboard doesn't look like
// just another not-yet-built analytics page.
export const DashboardIcon = ({ className }) => (
  <Base className={className}>
    <path d="M3.5 13a6.5 6.5 0 1 1 13 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 13 13 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="10" cy="13" r="1" fill="currentColor" />
  </Base>
);

export const BarChartIcon = ({ className }) => (
  <Base className={className}>
    <path d="M4 16V9M10 16V4M16 16v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Base>
);

export const CardIcon = ({ className }) => (
  <Base className={className}>
    <rect x="2.5" y="5" width="15" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.5" />
  </Base>
);

export const DocumentIcon = ({ className }) => (
  <Base className={className}>
    <path d="M6 2.5h6l3 3V17H6V2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M8 9h4M8 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Base>
);

export const ShopBagIcon = ({ className }) => (
  <Base className={className}>
    <path d="M5 6.5h10l1 11H4l1-11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.5 6.5a2.5 2.5 0 0 1 5 0" stroke="currentColor" strokeWidth="1.5" />
  </Base>
);

export const LinkIcon = ({ className }) => (
  <Base className={className}>
    <path
      d="M8.5 11.5 11.5 8.5M7 12.5 4.8 14.7a2.3 2.3 0 0 1-3.2-3.2L4 9.3M13 7.5l2.2-2.2a2.3 2.3 0 0 1 3.2 3.2L16.2 10.7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Base>
);

/** Stacked layers — same mark as the Integrations page header. */
export const IntegrationsIcon = ({ className }) => (
  <Base className={className}>
    <path
      d="M10 2.5 17.5 6.5 10 10.5 2.5 6.5 10 2.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M2.5 10.5 10 14.5l7.5-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.5 14 10 18l7.5-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Base>
);

export const WalletIcon = ({ className }) => (
  <Base className={className}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h9A1.5 1.5 0 0 1 15 6.5V15H4.5A1.5 1.5 0 0 1 3 13.5v-7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M15 9h2v4h-2a2 2 0 0 1 0-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </Base>
);

// Stacked documents - used for "Batch" (saved loadsheet/airway-bill runs).
export const LayersIcon = ({ className }) => (
  <Base className={className}>
    <path
      d="m10 3 7 3.5-7 3.5-7-3.5L10 3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="m3 10 7 3.5 7-3.5M3 13.5 10 17l7-3.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Base>
);
