"use client";

import { trackingLink } from "../../lib/trackingLink";

// A tracking number that opens the courier's own tracking page, prefilled,
// in a new tab. Plain text when the courier has no known tracking page.
// Clicks don't reach the row underneath (rows select / open the order).
export default function TrackingLink({ courier, tracking, fallback = "—", className = "", onDark = false }) {
  const value = (tracking || "").trim();
  if (!value) return <span className={className}>{fallback}</span>;
  const link = trackingLink(courier, value);
  if (!link) return <span className={className}>{value}</span>;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.copy ? `Open ${link.label} tracking (number copied - paste it there)` : `Track on ${link.label}`}
      onClick={(e) => {
        e.stopPropagation();
        if (link.then) {
          // Two steps in the new tab: the first URL saves the number on the
          // courier's side, then the tab moves on to the result page.
          e.preventDefault();
          // Keep the tab's opener: a browser only lets this page move a tab
          // it opened while that link is intact (cutting it with
          // `opener = null` silently blocks the second step).
          const tab = window.open(link.url, "_blank");
          if (tab) {
            setTimeout(() => {
              try {
                tab.location.href = link.then;
              } catch {
                // Tab closed in the meantime.
              }
            }, 2000);
          }
          return;
        }
        if (link.copy) {
          try {
            navigator.clipboard?.writeText(value);
          } catch {
            // Copying is a convenience - the page still opens.
          }
        }
      }}
      className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${
        onDark ? "text-white hover:text-brand-100" : "text-brand-700 hover:text-brand-900"
      } ${className}`}
    >
      {value}
    </a>
  );
}
