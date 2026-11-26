"use client";

// Critical Orders > Shipper Advice Needed: the Auto Reattempt switch (user,
// 2026-11-26 - backend oms.auto_advice). On: every order here that its
// courier opened for advice ("Open for advice") gets Reattempt by itself,
// whatever the reason. In a store it's that store's switch; in the Dispatch
// Hub, one switch for every Hub store. While the server runs it as a dry
// run, nothing is sent - the log lists what it would have sent.

import { useCallback, useEffect, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";
import { formatDateTime } from "../../lib/formatDate";

const RESULT = {
  would_send: { label: "Would send", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  sent: { label: "Sent", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  refused: { label: "Refused", cls: "bg-red-50 text-red-700 ring-red-200" },
  error: { label: "Error", cls: "bg-red-50 text-red-700 ring-red-200" },
};

function Switch({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function BoltIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${className} shrink-0`} aria-hidden="true">
      <path
        d="M11.2 2.5 4.5 11h4.8l-.9 6.5L15.5 9h-4.8l.5-6.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogTable({ rows, showStore, onOpenOrder }) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-slate-500">Nothing yet - it checks every few minutes.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="text-[11px] uppercase text-slate-500">
          <tr className="border-b border-surface-border">
            <th className="py-2 pr-3 font-medium">Time</th>
            <th className="py-2 pr-3 font-medium">Order</th>
            {showStore ? <th className="py-2 pr-3 font-medium">Store</th> : null}
            <th className="py-2 pr-3 font-medium">Courier</th>
            <th className="py-2 pr-3 font-medium">Result</th>
            <th className="py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const result = RESULT[r.result] || RESULT.error;
            return (
              <tr key={`${r.order_id}-${r.at}-${i}`} className="border-b border-surface-border/60 align-top last:border-0">
                <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{formatDateTime(r.at)}</td>
                <td className="whitespace-nowrap py-2 pr-3">
                  {onOpenOrder ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrder(r.order_id)}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {r.order_number}
                    </button>
                  ) : (
                    <span className="font-medium text-slate-800">{r.order_number}</span>
                  )}
                </td>
                {showStore ? <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{r.store}</td> : null}
                <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{r.courier || "—"}</td>
                <td className="whitespace-nowrap py-2 pr-3">
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${result.cls}`}>
                    {result.label}
                  </span>
                </td>
                <td className="py-2 text-slate-600">{r.result === "sent" || r.result === "would_send" ? r.advice : r.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AutoAdviceBar({ canWrite, refreshKey = 0, onOpenOrder, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await ordersService.autoAdvice());
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load Auto Reattempt");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // The check runs on the server every few minutes - keep the counts fresh
  // without a page reload.
  useEffect(() => {
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  async function save(enabled) {
    setSaving(true);
    setError("");
    try {
      setData(await ordersService.setAutoAdvice(enabled));
      setConfirmOn(false);
      onChanged?.();
    } catch (err) {
      setError(err.message || "Failed to change Auto Reattempt");
    } finally {
      setSaving(false);
    }
  }

  if (!data?.scope) {
    return error ? <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null;
  }

  const hub = data.scope === "hub";
  const dryRun = data.mode === "dry_run";
  const on = Boolean(data.enabled);
  const effective = on || data.hub_on;
  const today = data.today || {};
  const todayText = dryRun
    ? `Today: would send ${today.would_send || 0}`
    : `Today: ${today.sent || 0} sent${today.refused ? ` · ${today.refused} refused` : ""}`;

  return (
    <>
      <div
        className={`mb-3 rounded-lg border px-3 py-2.5 ${
          effective ? "border-brand-200 bg-brand-50/50" : "border-surface-border bg-white"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <Switch
              checked={on}
              disabled={!canWrite || saving}
              label="Auto Reattempt"
              onChange={(next) => (next ? setConfirmOn(true) : save(false))}
            />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                <BoltIcon className={`h-4 w-4 ${effective ? "text-brand-600" : "text-slate-400"}`} />
                Auto Reattempt {hub ? "· all Dispatch Hub stores" : ""}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                    on ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-slate-100 text-slate-500 ring-slate-200"
                  }`}
                >
                  {on ? "ON" : "OFF"}
                </span>
                {dryRun ? (
                  <span
                    className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                    title="Trial run: nothing is sent to the couriers yet - the log shows what it would have sent."
                  >
                    Dry run · nothing is sent yet
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Every order here that is <span className="font-medium text-emerald-700">Open for advice</span> gets
                Reattempt by itself: &ldquo;{data.remarks}&rdquo; Checked every {data.interval_minutes} min.
              </p>
              {!hub && data.hub_on && !on ? (
                <p className="mt-0.5 text-xs font-medium text-brand-700">
                  On for this store from FynkTech&apos;s Dispatch Hub.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-600">{todayText}</span>
            <button
              type="button"
              onClick={() => {
                load();
                setLogOpen(true);
              }}
              className="font-medium text-brand-700 hover:underline"
            >
              View log
            </button>
          </div>
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p> : null}
      </div>

      <Modal
        open={confirmOn}
        onClose={() => setConfirmOn(false)}
        title="Turn on Auto Reattempt?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOn(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => save(true)} loading={saving}>
              Turn on
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            Every order in Shipper Advice Needed {hub ? "of every Dispatch Hub store " : ""}that its courier opens for
            advice will get <span className="font-semibold">Reattempt</span> by itself, whatever the reason, with:
          </p>
          <p className="rounded-md bg-surface px-3 py-2 text-slate-800">&ldquo;{data.remarks}&rdquo;</p>
          <p className="text-xs text-slate-500">
            Checked every {data.interval_minutes} minutes. Orders not open yet wait until the courier opens them. You
            can turn it off any time.
          </p>
          {dryRun ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Dry run for now: nothing is sent to the couriers - View log shows what it would have sent.
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title={`Auto Reattempt log${dryRun ? " (dry run)" : ""}`}
        width="max-w-3xl"
      >
        <LogTable
          rows={data.log || []}
          showStore={hub}
          onOpenOrder={
            onOpenOrder
              ? (id) => {
                  setLogOpen(false);
                  onOpenOrder(id);
                }
              : null
          }
        />
      </Modal>
    </>
  );
}
