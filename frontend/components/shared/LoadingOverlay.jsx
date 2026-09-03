"use client";

import { useEffect, useState } from "react";
import useLoadingStore from "../../store/loadingStore";

// Small delay before showing, and a minimum time once shown, so a fast
// operation (a couple hundred ms) doesn't flash the overlay on and off -
// only genuinely slow things (page loads, bulk actions, CSV export/
// import, Shopify/Smartlane sync) end up actually displaying it.
const SHOW_DELAY_MS = 200;
const MIN_VISIBLE_MS = 400;

export default function LoadingOverlay() {
  const count = useLoadingStore((s) => s.count);
  const label = useLoadingStore((s) => s.label);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (count > 0) {
      const showTimer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      return () => clearTimeout(showTimer);
    }
    // Nothing left running - but if we're already visible, hold it up for
    // the minimum duration rather than snapping it away instantly.
    if (visible) {
      const hideTimer = setTimeout(() => setVisible(false), MIN_VISIBLE_MS);
      return () => clearTimeout(hideTimer);
    }
    return undefined;
  }, [count, visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px]"
    >
      <style>{`
        @keyframes loading-overlay-scroll {
          from { background-position: 0 0; }
          to { background-position: 28px 0; }
        }
        .loading-overlay-bar {
          background-image: repeating-linear-gradient(
            135deg,
            currentColor 0 10px,
            transparent 10px 20px
          );
          animation: loading-overlay-scroll 0.9s linear infinite;
        }
      `}</style>
      <div className="flex flex-col items-center gap-4 rounded-xl bg-white px-10 py-8 shadow-2xl">
        <div className="h-2.5 w-48 overflow-hidden rounded-full bg-brand-100">
          <div className="loading-overlay-bar h-full w-full text-brand-800" />
        </div>
        <p className="text-sm font-medium uppercase tracking-wide text-brand-800">{label}…</p>
      </div>
    </div>
  );
}
