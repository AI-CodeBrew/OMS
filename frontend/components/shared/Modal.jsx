"use client";

import { useEffect } from "react";

// headerRight: optional content shown at the top right, just before the ✕.
export default function Modal({ open, onClose, title, headerRight, children, footer, width = "max-w-lg" }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-4">
      <div
        // Never taller than the screen: the body scrolls, so the header (and
        // its buttons) always stays in view.
        className={`flex max-h-full w-full ${width} flex-col rounded-lg border border-surface-border bg-white shadow-lg`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-surface-border px-5 py-3">
          <h2 className="min-w-0 text-sm font-semibold text-slate-900">{title}</h2>
          <div className="flex shrink-0 items-center gap-4">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="max-h-[70vh] min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 justify-end gap-2 border-t border-surface-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
