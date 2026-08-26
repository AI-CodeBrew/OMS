"use client";

import Badge from "../shared/Badge";

const ATTENTION_STATUSES = [
  { value: "city_issue", label: "City Issue" },
  { value: "dispatch_issue", label: "Dispatch Issue" },
];

export default function OrdersSidebar({
  counts,
  activeStatus,
  onSelectStatus,
  gateway,
  onSelectGateway,
  courierId,
  onSelectCourier,
  couriers,
}) {
  return (
    <aside className="w-56 shrink-0 space-y-6">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Needs Attention
        </h3>
        <ul className="space-y-1">
          {ATTENTION_STATUSES.map((s) => {
            const count = counts?.[s.value] ?? 0;
            const isActive = activeStatus === s.value;
            return (
              <li key={s.value}>
                <button
                  type="button"
                  onClick={() => onSelectStatus(s.value)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                    isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-surface"
                  }`}
                >
                  <span>{s.label}</span>
                  <Badge variant={count > 0 ? "red" : "neutral"}>{count}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          By Gateway
        </h3>
        <div className="flex gap-1">
          {["", "cod", "cc"].map((g) => (
            <button
              key={g || "any"}
              type="button"
              onClick={() => onSelectGateway(g)}
              className={`rounded-md px-2 py-1 text-xs font-medium uppercase ${
                gateway === g
                  ? "bg-brand-600 text-white"
                  : "border border-surface-border text-slate-600 hover:bg-surface"
              }`}
            >
              {g || "Any"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          By Courier
        </h3>
        {couriers.length === 0 ? (
          <p className="text-xs text-slate-400">No couriers yet.</p>
        ) : (
          <ul className="space-y-1">
            <li>
              <button
                type="button"
                onClick={() => onSelectCourier("")}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  !courierId ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-surface"
                }`}
              >
                All couriers
              </button>
            </li>
            {couriers.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectCourier(c.id)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    courierId === c.id ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-surface"
                  }`}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
