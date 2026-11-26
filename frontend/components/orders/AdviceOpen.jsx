"use client";

import { formatDateTime } from "../../lib/formatDate";

// Is the courier waiting for our Shipper Advice right now - by the courier's
// own status (backend: oms.services.advice_open_map, order.advice_open =
// {open, courier, status, sent}, null when the courier can't say). User,
// 2026-11-26: couriers refuse advice until they open it, hours after the
// failed attempt.

// Where each courier opens it - its own words.
const OPENS_AT = {
  PostEx: '"Delivery Under Review"',
  BarqRaftar: '"Return Confirmation"',
  Leopards: "an open request on its Shipper Advice list",
};

function info(order) {
  return order?.workflow_card === "undelivered" ? order.advice_open || null : null;
}

function LiveDot() {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
    </span>
  );
}

function ClockIcon({ className = "h-2.5 w-2.5" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${className} shrink-0`} aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 6.5V10l2.5 1.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${className} shrink-0`} aria-hidden="true">
      <path
        d="M8.6 3.4a1.6 1.6 0 0 1 2.8 0l6 10.6A1.6 1.6 0 0 1 16 16.4H4a1.6 1.6 0 0 1-1.4-2.4l6-10.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 7.5v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="13.6" r="0.95" fill="currentColor" />
    </svg>
  );
}

function CheckIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${className} shrink-0`} aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="m6.75 10.25 2.25 2.25 4.25-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// "Reattempt, 26/11/2026, 03:40 PM" - the advice we gave and when.
function givenText(a) {
  return [a.advice, a.advice_at ? formatDateTime(a.advice_at) : ""].filter(Boolean).join(", ");
}

// The small pill under an Undelivered order's status: "Open for advice"
// (green, live dot) while the courier waits for it, "Advice given ·
// Reattempt / Return" (indigo) once we sent it - every courier (user,
// 2026-11-26) - and "Not open yet" (grey) before the courier opens it.
// Nothing when the courier can't say and no advice was given.
export function AdviceOpenBadge({ order, className = "" }) {
  const a = info(order);
  if (!a) return null;
  if (a.sent && !a.open) {
    const to = a.courier ? ` to ${a.courier}` : "";
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 ${className}`}
        title={`Shipper Advice sent${to}: ${givenText(a) || "given"}.${
          a.status ? ` ${a.courier} status: ${a.status}.` : ""
        } It shows "Open for advice" again only if the courier asks again after its next try.`}
      >
        <CheckIcon className="h-2.5 w-2.5" />
        {a.advice ? `Advice given · ${a.advice}` : "Advice given"}
      </span>
    );
  }
  if (a.open) {
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 ${className}`}
        title={`${a.courier} is waiting for your Shipper Advice (${a.courier} status: ${a.status}).`}
      >
        <LiveDot />
        Open for advice
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ${className}`}
      title={`${a.courier} hasn't opened this for advice yet (${a.courier} status: ${a.status}). It opens at ${
        OPENS_AT[a.courier] || "its own advice step"
      } - usually a few hours after the failed attempt.`}
    >
      <ClockIcon />
      Not open yet
    </span>
  );
}

// The Shipper Advice popup's note: a warning when the courier hasn't opened
// (some of) the orders for advice - it will most likely refuse them - or a
// green line when it waits for all of them. Sending stays possible: the
// courier decides.
export function AdviceOpenNotice({ orders }) {
  const known = (orders || []).map((o) => ({ order: o, a: info(o) })).filter((x) => x.a);
  if (!known.length) return null;
  const closed = known.filter((x) => !x.a.open);
  const total = (orders || []).length;

  if (!closed.length) {
    const couriers = [...new Set(known.map((x) => x.a.courier))].join(" / ");
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckIcon className="h-4 w-4 text-emerald-600" />
        <span>
          {total === 1
            ? `${couriers} is waiting for your advice on this order.`
            : `${couriers.includes("/") ? "The couriers are" : `${couriers} is`} waiting for your advice on ${
                known.length === total ? `all ${total}` : `${known.length} of ${total}`
              } orders.`}
        </span>
      </div>
    );
  }

  const single = total === 1 && closed.length === 1;
  const first = closed[0].a;
  const allSent = closed.every((x) => x.a.sent);
  const title = single
    ? first.sent
      ? `Advice already given for this order${first.advice ? ` (${first.advice})` : ""}`
      : `${first.courier} hasn't opened this order for advice yet`
    : allSent
      ? `Advice already given for ${closed.length} of ${total} orders`
      : `${closed.length} of ${total} orders aren't open for advice`;
  const opens = [...new Set(closed.filter((x) => !x.a.sent).map((x) => x.a.courier))]
    .map((c) => `${c} at ${OPENS_AT[c] || "its own advice step"}`)
    .join(", ");

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
      <div className="flex gap-2.5">
        <WarningIcon className="mt-0.5 h-4 w-4 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">{title}</p>
          <ul className="mt-1.5 space-y-1">
            {closed.slice(0, 5).map(({ order, a }) => (
              <li key={order.id} className="flex flex-wrap items-center gap-x-1.5 text-xs text-amber-900">
                {!single ? <span className="font-medium">{order.order_number}</span> : null}
                {a.sent ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700 ring-1 ring-inset ring-indigo-200">
                    <CheckIcon className="h-2.5 w-2.5" />
                    {`Advice given${givenText(a) ? ` - ${givenText(a)}` : ""}`}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-1.5 py-0.5 text-[11px] text-amber-800 ring-1 ring-inset ring-amber-200">
                    <ClockIcon />
                    {`${a.courier}: ${a.status}`}
                  </span>
                )}
              </li>
            ))}
            {closed.length > 5 ? (
              <li className="text-xs text-amber-700">and {closed.length - 5} more</li>
            ) : null}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            {allSent
              ? "The courier already has your advice - a second one is most likely refused. It opens again only if the courier asks again after its next try."
              : `The courier will most likely refuse it. Advice opens ${opens} - usually a few hours after the failed attempt.`}{" "}
            You can still send it; the courier decides.
          </p>
        </div>
      </div>
    </div>
  );
}
