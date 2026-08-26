"use client";

export default function ProbabilityBadge({ cancelledPct, returnedPct, deliveredPct }) {
  if (cancelledPct === null || cancelledPct === undefined) {
    return <span className="text-xs text-slate-300">—</span>;
  }

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
        C{cancelledPct}%
      </span>
      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
        R{returnedPct}%
      </span>
      <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
        D{deliveredPct}%
      </span>
    </span>
  );
}
