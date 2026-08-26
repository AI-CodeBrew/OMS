"use client";

import { useEffect } from "react";

export default function Modal({ open, onClose, title, children, footer, width = "max-w-lg" }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div
        className={`w-full ${width} rounded-lg border border-surface-border bg-white shadow-lg`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-surface-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
