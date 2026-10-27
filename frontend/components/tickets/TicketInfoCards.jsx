"use client";

// One labelled card with a purple left edge - the ticket views' Description
// box (store popup and the super admin's ticket page).
export function InfoCard({ label, children }) {
  return (
    <div className="rounded-lg border border-surface-border border-l-4 border-l-brand-600 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
  );
}
