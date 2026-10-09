"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ordersService from "../../services/ordersService";
import useCriticalOrdersStore from "../../store/criticalOrdersStore";
import { useEffectiveUser } from "../../store/authStore";
import { canAccessPath } from "../layout/moduleNav";

// How often the count is refreshed (it drives the bell's badge), and how
// long to leave between alerts: while there are critical orders, the alert
// comes back every 2 hours.
const CHECK_EVERY_MS = 5 * 60 * 1000;
const ALERT_EVERY_MS = 2 * 60 * 60 * 1000;
const LAST_ALERT_KEY = "oms_critical_alert_at";

function readLastAlert(key) {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeLastAlert(key, at) {
  try {
    window.localStorage.setItem(key, String(at));
  } catch {
    // Storage unavailable - the alert may then come back on a reload.
  }
}

/**
 * Tells the user when orders have been in transit for more than 3 days
 * (the Critical Orders tab), and again every 2 hours for as long as there
 * are any. Only while the app is open - there is no background sender.
 */
export default function CriticalOrdersAlert() {
  const router = useRouter();
  const user = useEffectiveUser();
  const setCount = useCriticalOrdersStore((s) => s.setCount);
  const [alertCount, setAlertCount] = useState(0);
  const checking = useRef(false);

  const allowed = Boolean(user) && canAccessPath(user, "/orders");
  // Per person and store - a super admin switching stores, or two people
  // sharing a browser, each get their own 2-hour clock.
  const storageKey = `${LAST_ALERT_KEY}:${user?.id || ""}:${user?.organization_id || "hub"}`;

  useEffect(() => {
    if (!allowed) return undefined;
    let cancelled = false;

    async function check() {
      if (checking.current) return;
      checking.current = true;
      try {
        const counts = await ordersService.counts();
        if (cancelled) return;
        const critical = Number(counts?.critical) || 0;
        setCount(critical);
        if (critical === 0) {
          setAlertCount(0);
          return;
        }
        if (Date.now() - readLastAlert(storageKey) >= ALERT_EVERY_MS) {
          writeLastAlert(storageKey, Date.now());
          setAlertCount(critical);
        }
      } catch {
        // A failed check just waits for the next one.
      } finally {
        checking.current = false;
      }
    }

    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [allowed, storageKey, setCount]);

  if (!allowed || alertCount === 0) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-red-200 bg-white p-4 shadow-lg"
    >
      <div className="text-sm font-semibold text-red-700">Critical orders</div>
      <p className="mt-1 text-sm text-slate-700">
        {alertCount} order{alertCount === 1 ? " has" : "s have"} been in transit for more than 3 days.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setAlertCount(0)}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => {
            setAlertCount(0);
            router.push("/orders?status=critical");
          }}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          View orders
        </button>
      </div>
    </div>
  );
}
