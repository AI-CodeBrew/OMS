"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import notificationsService from "../../services/notificationsService";
import timeAgo from "../../lib/timeAgo";

const POLL_MS = 60000;

function BellIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 2.5c-2.2 0-4 1.8-4 4v2.3c0 .5-.2 1-.5 1.4L4.5 11.5A1 1 0 0 0 5.3 13h9.4a1 1 0 0 0 .8-1.6L14.5 10.2a2 2 0 0 1-.5-1.4V6.5c0-2.2-1.8-4-4-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8.3 16a1.8 1.8 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// The header's bell: the store's notifications (backend core/
// notification_service.py - today, FynkTech changing one of its orders)
// plus the critical-orders alert it used to show on its own. Opening it
// marks what's shown as read; a super admin looking at a store's bell
// marks nothing (the backend ignores it).
export default function NotificationBell({ criticalCount = 0, canMarkRead = true }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await notificationsService.list();
      setItems(data.notifications || []);
      setUnread(data.unread_count || 0);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const data = await load();
    // The list keeps showing which ones were new until it's next loaded.
    if (canMarkRead && data?.unread_count) {
      notificationsService.markRead().catch(() => {});
      setUnread(0);
    }
  }

  const badge = unread + (criticalCount > 0 ? criticalCount : 0);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="relative rounded-md p-2 text-brand-100 hover:bg-white/10 hover:text-white"
        title="Notifications"
      >
        <BellIcon className="h-5 w-5" />
        {badge > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-surface-border bg-white shadow-lg">
          <div className="border-b border-surface-border px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {criticalCount > 0 ? (
              <Link
                href="/orders?status=critical"
                onClick={() => setOpen(false)}
                className="block border-b border-surface-border bg-red-50 px-4 py-3 text-sm text-red-700 hover:bg-red-100"
              >
                <span className="font-medium">
                  {criticalCount} order{criticalCount === 1 ? "" : "s"}
                </span>{" "}
                in transit for more than 3 days →
              </Link>
            ) : null}
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {items.map((n) => (
                  <li key={n.id} className={`px-4 py-3 ${n.is_read ? "" : "bg-brand-50/60"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{n.title}</p>
                      <span
                        className="shrink-0 text-[11px] text-slate-400"
                        title={new Date(n.created_at).toLocaleString()}
                      >
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    {n.changes?.length ? (
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {n.changes.map((c) => (
                          <li key={c.field}>
                            <span className="font-medium">{c.label}:</span>{" "}
                            <span className="text-slate-400 line-through">{c.old}</span> → {c.new}
                          </li>
                        ))}
                      </ul>
                    ) : n.message ? (
                      <p className="mt-1 text-xs text-slate-600">{n.message}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
