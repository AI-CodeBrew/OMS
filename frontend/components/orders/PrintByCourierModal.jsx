"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import AirwayBillFilterModal from "./AirwayBillFilterModal";
import ordersService from "../../services/ordersService";
import barqraftarService from "../../app/(tenant)/integrations/barq-raftar/_lib/barqraftarService";
import postexService from "../../app/(tenant)/integrations/postex/_lib/postexService";
import { SMARTLANE_LOAD_SHEET_COURIERS } from "./statusConfig";
import { BOOKING_ACCOUNT_LABELS, SMARTLANE_ACCOUNTS, orderBookingAccount } from "./orderBookingAccount";

function CheckIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 10.5 8 14.5 16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TITLES = { loadsheet: "Print Loadsheet", airway_bill: "Print Airway Bill" };

function plural(count) {
  return `${count} order${count === 1 ? "" : "s"}`;
}

// The same service calls the per-courier actions make (see orders/page.jsx's
// startAction/runAction) - this only decides which one, for which orders.
function printDocument(kind, account, orderIds, smartlaneCourier) {
  if (SMARTLANE_ACCOUNTS.has(account)) {
    if (kind === "airway_bill") return ordersService.printSmartlaneAirwayBill(orderIds);
    const couriers =
      smartlaneCourier === "all"
        ? SMARTLANE_LOAD_SHEET_COURIERS.filter((c) => !c.disabled && c.value !== "all").map((c) => c.value)
        : [smartlaneCourier];
    return ordersService.printSmartlaneLoadSheetForCouriers(orderIds, couriers);
  }
  if (account === "barqraftar") {
    return kind === "airway_bill"
      ? barqraftarService.printLabels(orderIds)
      : barqraftarService.printLoadSheet(orderIds);
  }
  return kind === "airway_bill" ? postexService.printAirwayBills(orderIds) : postexService.printLoadSheet(orderIds);
}

/**
 * The bulk "Print Loadsheet" / "Print Airway Bill" buttons used to always go
 * to Smartlane. This asks which connected courier's document to download
 * instead, and sends each courier only the selected orders it actually
 * booked. A green tick marks each one downloaded - it can still be
 * downloaded again.
 *
 * request: { kind: "loadsheet" | "airway_bill", orders } while open.
 * accounts: the connected booking accounts, in display order (see
 * orderBookingAccount's BOOKING_ACCOUNT_LABELS for the ids).
 * onPrinted(kind, account): after each successful download.
 */
export default function PrintByCourierModal({ request, accounts, onClose, onPrinted }) {
  // Kept across re-opens (this component stays mounted, it only renders
  // nothing while closed), so reopening for the same orders still shows
  // what was already downloaded.
  const [printed, setPrinted] = useState(() => new Set());
  const [working, setWorking] = useState(null);
  const [errors, setErrors] = useState({});
  const [smartlaneCourier, setSmartlaneCourier] = useState({});
  const [splitAccount, setSplitAccount] = useState(null);

  useEffect(() => {
    setWorking(null);
    setErrors({});
    setSmartlaneCourier({});
    setSplitAccount(null);
  }, [request]);

  const groups = useMemo(() => {
    const byAccount = Object.fromEntries(accounts.map((id) => [id, []]));
    // An order no integration booked goes to Smartlane, as every bulk print
    // did before - own account first, same fallback as the backend's
    // SmartlaneConnection.for_order.
    const fallback = accounts.find((id) => SMARTLANE_ACCOUNTS.has(id));
    let unmatched = 0;
    for (const order of request?.orders || []) {
      const account = orderBookingAccount(order) || fallback;
      if (account && byAccount[account]) byAccount[account].push(order);
      else unmatched += 1;
    }
    return { byAccount, unmatched };
  }, [request, accounts]);

  if (!request) return null;

  const { kind, orders } = request;

  function printedKey(account) {
    const ids = groups.byAccount[account].map((o) => String(o.id)).sort().join(",");
    const variant = kind === "loadsheet" && SMARTLANE_ACCOUNTS.has(account) ? smartlaneCourier[account] || "all" : "";
    return `${kind}|${account}|${variant}|${ids}`;
  }

  function markPrinted(account) {
    const key = printedKey(account);
    setPrinted((prev) => new Set(prev).add(key));
  }

  async function download(account) {
    const accountOrders = groups.byAccount[account];
    // Smartlane's multi-order airway bill keeps its split-by-product /
    // by-order-id step, same as before.
    if (kind === "airway_bill" && SMARTLANE_ACCOUNTS.has(account) && accountOrders.length > 1) {
      setSplitAccount(account);
      return;
    }
    // PostEx's load sheet is also their hand-over step - confirmed first,
    // same as the per-courier action.
    if (
      kind === "loadsheet" &&
      account === "postex" &&
      !window.confirm(
        `Generate the PostEx load sheet for ${plural(accountOrders.length)}? This hands the parcels over to PostEx for pickup.`
      )
    ) {
      return;
    }
    setWorking(account);
    setErrors((prev) => ({ ...prev, [account]: "" }));
    try {
      await printDocument(
        kind,
        account,
        accountOrders.map((o) => o.id),
        smartlaneCourier[account] || "all"
      );
      markPrinted(account);
      onPrinted?.(kind, account);
    } catch (err) {
      setErrors((prev) => ({ ...prev, [account]: err.message || "Print failed" }));
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      {/* No close while the airway bill split step is open on top - Escape
          there should close just that one. */}
      <Modal open title={TITLES[kind]} onClose={splitAccount ? undefined : onClose} width="max-w-lg">
        <p className="mb-3 text-sm text-slate-500">
          {plural(orders.length)} selected. Choose the courier to download for.
        </p>

        {accounts.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            No courier is connected - connect one from the Integrations page.
          </p>
        ) : (
          <div className="rounded-md border border-surface-border">
            {accounts.map((account) => {
              const count = groups.byAccount[account].length;
              const done = count > 0 && printed.has(printedKey(account));
              return (
                <div key={account} className="border-b border-surface-border px-3 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800">{BOOKING_ACCOUNT_LABELS[account]}</div>
                      <div className="text-xs text-slate-400">
                        {count > 0 ? plural(count) : "None of the selected orders"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {kind === "loadsheet" && SMARTLANE_ACCOUNTS.has(account) && count > 0 ? (
                        <select
                          value={smartlaneCourier[account] || "all"}
                          onChange={(e) =>
                            setSmartlaneCourier((prev) => ({ ...prev, [account]: e.target.value }))
                          }
                          disabled={Boolean(working)}
                          aria-label="Smartlane courier"
                          className="rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
                        >
                          {SMARTLANE_LOAD_SHEET_COURIERS.map((c) => (
                            <option key={c.value} value={c.value} disabled={c.disabled}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {done ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                          <CheckIcon className="h-4 w-4" />
                          Downloaded
                        </span>
                      ) : null}
                      <Button
                        variant={done ? "secondary" : "primary"}
                        loading={working === account}
                        disabled={count === 0 || Boolean(working && working !== account)}
                        onClick={() => download(account)}
                      >
                        {done ? "Download again" : "Download"}
                      </Button>
                    </div>
                  </div>
                  {errors[account] ? <p className="mt-1 text-xs text-red-600">{errors[account]}</p> : null}
                </div>
              );
            })}
          </div>
        )}

        {groups.unmatched > 0 ? (
          <p className="mt-3 text-xs text-amber-600">
            {plural(groups.unmatched)} weren&apos;t booked through a connected courier, so{" "}
            {groups.unmatched === 1 ? "it isn't" : "they aren't"} in any of these.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>

      <AirwayBillFilterModal
        orders={splitAccount ? groups.byAccount[splitAccount] : null}
        onClose={() => setSplitAccount(null)}
        onGenerated={() => markPrinted(splitAccount)}
      />
    </>
  );
}
