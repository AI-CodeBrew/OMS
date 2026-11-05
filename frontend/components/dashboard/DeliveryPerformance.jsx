"use client";

import { useEffect, useState } from "react";

// Delivery rate colour (status, so always beside its number, never alone):
// green from 70%, amber from 50%, red below.
function rateTone(pct) {
  if (pct == null) return "text-slate-400";
  if (pct >= 70) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

function formatPct(pct) {
  return pct == null ? "—" : `${pct.toFixed(1)}%`;
}

const ALL = "__all__";

// One province card in the popup: delivery rate big, share small.
function ProvinceCard({ row }) {
  return (
    <div className="group relative rounded-md border border-surface-border bg-white px-3 py-2">
      <div className="truncate text-xs font-medium text-slate-700">{row.name}</div>
      <div className={`text-sm font-semibold ${rateTone(row.delivery_pct)}`}>{formatPct(row.delivery_pct)}</div>
      <div className="text-[11px] text-slate-400">
        {row.share_pct.toFixed(1)}%
      </div>
      {/* Hover tooltip */}
      <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
        <div>{formatPct(row.delivery_pct)} Delivery Ratio</div>
        <div>{row.share_pct.toFixed(1)}% of Total Orders</div>
      </div>
    </div>
  );
}

// One stat in the popup header: number first, label after.
function HeaderStat({ value, label, tone = "text-slate-900" }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <dd className={`font-semibold tabular-nums ${tone}`}>{value}</dd>
      <dt className="text-slate-500">{label}</dt>
    </div>
  );
}

// Opened from the Top couriers card: provinces for all couriers, or for
// the one picked (a bar click opens straight on that courier).
function ProvincesPopup({ data, initialCourier, onClose }) {
  const [picked, setPicked] = useState(initialCourier || ALL);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const courier = data.couriers.find((c) => c.name === picked);
  const subject = courier || { ...data.overall, provinces: data.provinces };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-4 border-b border-surface-border px-5 py-4">
          <h3 className="shrink-0 text-lg font-semibold text-slate-900">{courier ? courier.name : "All Couriers"}</h3>
          {/* Stats spread over the rest of the row, next to the name. */}
          <dl className="flex flex-1 flex-wrap items-center justify-around gap-x-6 gap-y-2 text-sm">
            <HeaderStat
              value={formatPct(subject.delivery_pct)}
              label="Delivery"
              tone={rateTone(subject.delivery_pct)}
            />
            {courier ? <HeaderStat value={`${courier.share_pct.toFixed(1)}%`} label="of Booked Orders" /> : null}
            <HeaderStat value={subject.orders.toLocaleString()} label="Orders" />
            <HeaderStat
              value={subject.provinces.length}
              label={subject.provinces.length === 1 ? "Province" : "Provinces"}
            />
          </dl>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-surface hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[{ name: ALL, label: "All Couriers" }, ...data.couriers.map((c) => ({ name: c.name, label: c.name }))].map(
              (option) => (
                <button
                  key={option.name}
                  type="button"
                  onClick={() => setPicked(option.name)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    picked === option.name
                      ? "bg-brand-800 text-white"
                      : "bg-surface text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {option.label}
                </button>
              )
            )}
          </div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">By Province</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {subject.provinces.map((p) => (
              <ProvinceCard key={p.name} row={p} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// The Dashboard's Top couriers card (sits beside Top Cities in
// DashboardCharts) (backend: oms.services.
// delivery_performance) for the picked date range: each courier's share
// of the orders as a horizontal bar, largest first. Clicking the card opens
// the provinces popup; clicking a bar opens it on that courier.
export default function DeliveryPerformance({ data }) {
  const [popup, setPopup] = useState(null); // null | {courier}
  if (!data) return null;
  const { overall, couriers = [] } = data;
  const maxShare = Math.max(...couriers.map((c) => c.share_pct), 1);

  return (
    <>
      <section
        role="button"
        tabIndex={0}
        title="Click to see Details"
        onClick={() => setPopup({ courier: null })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPopup({ courier: null });
          }
        }}
        className="flex cursor-pointer flex-col rounded-lg border border-surface-border bg-white p-4 transition hover:border-brand-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Top Couriers</h2>
            <p className="text-xs text-slate-500">Share of Orders · Click for Provinces</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">
              <span className={`font-semibold ${rateTone(overall.delivery_pct)}`}>
                {formatPct(overall.delivery_pct)}
              </span>{" "}
              Delivered
            </div>
          </div>
        </div>

        {!overall.orders ? (
          <p className="mt-4 text-sm text-slate-400">No Orders in This Range.</p>
        ) : (
          // Rows spread over the card's full height - it's as tall as Top
          // Cities beside it - so there's no empty space underneath.
          <ul className="mt-4 flex flex-1 flex-col justify-around gap-2.5">
            {couriers.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopup({ courier: c.name });
                  }}
                  title="Click to see Details"
                  className="group relative grid w-full grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 rounded py-1 text-left"
                >
                  <span className="truncate text-sm text-slate-700">
                    {c.name}
                  </span>
                  <span className="h-3 rounded-r bg-slate-100">
                    <span
                      className="block h-3 rounded-r bg-brand-600 transition group-hover:bg-brand-700"
                      style={{ width: c.orders ? `${Math.max((c.share_pct / maxShare) * 100, 1.5)}%` : 0 }}
                    />
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-900">
                    {c.share_pct.toFixed(1)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {popup ? (
        <ProvincesPopup data={data} initialCourier={popup.courier} onClose={() => setPopup(null)} />
      ) : null}
    </>
  );
}
