"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Pagination from "../../../../components/shared/Pagination";
import ticketsAdminService from "../../../../services/ticketsAdminService";
import { timeAgo } from "../../../../lib/timeAgo";
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_DOT,
  TICKET_STATUS_FILTERS,
  TICKET_PRIORITY_FILTERS,
} from "../../../../components/tickets/ticketStatus";

const ASSIGNED_FILTERS = [
  { value: "", label: "Everyone" },
  { value: "unassigned", label: "Unassigned" },
];

// Cross-org - every organization's tickets. Clicking a row goes to
// /admin/tickets/[id] (a dedicated page, not an inline accordion) since
// resolving/assigning/replying is enough surface area to deserve its own
// screen rather than fighting the list for space.
export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assigned, setAssigned] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await ticketsAdminService.list({
        q: appliedSearch,
        status,
        priority,
        assigned,
        page,
        page_size: pageSize,
      });
      setTickets(data.tickets || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, status, priority, assigned, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function onSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Tickets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every support ticket raised across every organization.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={onSearchSubmit}
          className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search org, order, category…"
            className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-64"
          />
          <button
            type="submit"
            className="rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface"
          >
            Search
          </button>
        </form>

        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="rounded-lg border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {TICKET_STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={priority}
          onChange={(e) => {
            setPage(1);
            setPriority(e.target.value);
          }}
          className="rounded-lg border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {TICKET_PRIORITY_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={assigned}
          onChange={(e) => {
            setPage(1);
            setAssigned(e.target.value);
          }}
          className="rounded-lg border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {ASSIGNED_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No tickets match these filters.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/admin/tickets/${t.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-surface/60"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      TICKET_PRIORITY_DOT[t.priority] || "bg-slate-400"
                    }`}
                    title={`${TICKET_PRIORITY_LABEL[t.priority] || t.priority} priority`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-slate-400">
                        {t.ticket_number}
                      </span>
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {t.category}
                        {t.sub_category ? (
                          <span className="font-normal text-slate-500"> — {t.sub_category}</span>
                        ) : null}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {t.organization_name} ·{" "}
                      {t.order_number ? `Order ${t.order_number} · ` : "Standalone · "}
                      {t.created_by_email || "Unknown"} ·{" "}
                      <span title={new Date(t.created_at).toLocaleString()}>
                        {timeAgo(t.created_at)}
                      </span>
                    </p>
                  </div>
                  {t.assigned_to_email ? (
                    <span className="hidden shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 sm:inline">
                      {t.assigned_to_email}
                    </span>
                  ) : null}
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      TICKET_STATUS_TONE[t.status] || "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {TICKET_STATUS_LABEL[t.status] || t.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && tickets.length > 0 ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          count={count}
          maxPageSize={100}
          itemLabel="tickets"
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      ) : null}
    </div>
  );
}
