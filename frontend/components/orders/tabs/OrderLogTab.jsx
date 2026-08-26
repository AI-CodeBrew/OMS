"use client";

import { useEffect, useState } from "react";
import ordersService from "../../../services/ordersService";
import { STATUS_LABELS } from "../statusConfig";

export default function OrderLogTab({ orderId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ordersService
      .listLog(orderId)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (events.length === 0) return <p className="text-sm text-slate-500">No status changes yet.</p>;

  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="rounded-md border border-surface-border bg-white px-3 py-2 text-sm">
          <p className="text-slate-800">
            {STATUS_LABELS[e.from_status] || e.from_status} → {STATUS_LABELS[e.to_status] || e.to_status}
          </p>
          {e.note ? <p className="mt-0.5 text-xs text-slate-500">{e.note}</p> : null}
          <p className="mt-1 text-xs text-slate-400">{new Date(e.created_at).toLocaleString()}</p>
        </li>
      ))}
    </ul>
  );
}
