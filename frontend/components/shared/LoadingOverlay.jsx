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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white/50 backdrop-blur-[2px]"
    >
      <style>{`
        @keyframes loading-overlay-slide {
          0% { left: -35%; width: 35%; }
          60% { left: 55%; width: 45%; }
          100% { left: 100%; width: 35%; }
        }
        .loading-overlay-bar {
          animation: loading-overlay-slide 1.3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
      <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-8 py-6 shadow-lg ring-1 ring-black/5">
        <div className="relative h-1 w-36 overflow-hidden rounded-full bg-slate-100">
          <div className="loading-overlay-bar absolute inset-y-0 rounded-full bg-brand-700" />
        </div>
        <p className="text-xs font-medium text-slate-500">{label}…</p>
      </div>
    </div>
  );
}
