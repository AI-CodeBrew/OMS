"use client";

import { useCallback, useEffect, useState } from "react";
import ticketsService from "../../../services/ticketsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import CreateTicketDialog from "../../../components/tickets/CreateTicketDialog";
import TicketDetailDialog from "../../../components/tickets/TicketDetailDialog";
import { timeAgo } from "../../../lib/timeAgo";
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_DOT,
  TICKET_STATUS_FILTERS,
  TICKET_PRIORITY_FILTERS,
} from "../../../components/tickets/ticketStatus";

function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EmptyState({ hasFilters }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <svg viewBox="0 0 20 20" fill="none" className="h-10 w-10 text-slate-300" aria-hidden="true">
        <path
          d="M2.5 7.5A1.5 1.5 0 0 1 4 6h12a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 0 0 3v1A1.5 1.5 0 0 1 16 14H4a1.5 1.5 0 0 1-1.5-1.5v-1a1.5 1.5 0 0 0 0-3v-1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-sm font-medium text-slate-600">
        {hasFilters ? "No tickets match these filters." : "No tickets yet."}
      </p>
      {!hasFilters ? (
        <p className="text-xs text-slate-400">Raise one from an order, or start a new one above.</p>
      ) : null}
    </div>
  );
}

// "My tickets" - deliberately every ticket *this user* raised, not every
// ticket in the org (see TicketViewSet.get_queryset on the backend); an
// order's own Tickets tab is where org-wide visibility for one order lives.
export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await ticketsService.list({
        q: appliedSearch,
        status,
        priority,
        page,
        page_size: pageSize,
      });
      setTickets(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, status, priority, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function onSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  const hasFilters = Boolean(appliedSearch || status || priority);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Tickets</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every support ticket you've raised, and the conversation with our team.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New ticket</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={onSearchSubmit}
          className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search category, order, description…"
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-64"
          />
          <button
            type="submit"
            className="rounded-md border border-surface-border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface"
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
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
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
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {TICKET_PRIORITY_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-lg border border-surface-border bg-white">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <ul className="divide-y divide-surface-border">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-4 py-3 hover:bg-surface/60">
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
                    <span className="truncate text-sm font-medium text-slate-900">
                      {t.category}
                      {t.sub_category ? (
                        <span className="font-normal text-slate-400"> — {t.sub_category}</span>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {t.order_number ? `Order ${t.order_number} · ` : ""}
                    <span title={new Date(t.created_at).toLocaleString()}>
                      {timeAgo(t.created_at)}
                    </span>
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    TICKET_STATUS_TONE[t.status] || "bg-slate-100 text-slate-600"
                  }`}
                >
                  {TICKET_STATUS_LABEL[t.status] || t.status}
                </span>
                <button
                  type="button"
                  aria-label="View ticket"
                  onClick={() => setViewing(t)}
                  className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-surface hover:text-slate-600"
                >
                  <EyeIcon />
                </button>
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
          maxPageSize={1000}
          itemLabel="tickets"
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      ) : null}

      <CreateTicketDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setPage(1);
          load();
        }}
      />
      <TicketDetailDialog ticket={viewing} open={Boolean(viewing)} onClose={() => setViewing(null)} />
    </div>
  );
}
