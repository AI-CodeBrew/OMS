"use client";

import { useCallback, useEffect, useState } from "react";
import ticketsService from "../../../services/ticketsService";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import CreateTicketDialog from "../../../components/tickets/CreateTicketDialog";
import TicketDetailDialog from "../../../components/tickets/TicketDetailDialog";
import TicketsTable from "../../../components/tickets/TicketsTable";
import { TICKET_STATUSES, TICKET_STATUS_LABEL } from "../../../components/tickets/ticketStatus";

// Two views, picked from the dropdown: "My Tickets" (the default) -
// deliberately every ticket *this user* raised, not every ticket in the
// org - and "By Admin", the ones FynkTech's super admin raised for this
// store (see TicketViewSet.get_queryset on the backend). An order's own
// Tickets tab is where org-wide visibility for one order lives.
const VIEWS = [
  { value: "mine", label: "My Tickets", hint: "Every support ticket you've raised, and the conversation with our team." },
  { value: "admin", label: "By Admin", hint: "Tickets our team has raised for your store." },
];

export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [view, setView] = useState("mine");
  const [status, setStatus] = useState("");
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
        scope: view === "admin" ? "admin" : undefined,
        q: appliedSearch,
        status,
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
  }, [view, appliedSearch, status, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function onSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  const hasFilters = Boolean(appliedSearch || status);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Tickets</h1>
          <p className="mt-1 text-sm text-slate-500">{VIEWS.find((v) => v.value === view).hint}</p>
        </div>
        <Button onClick={() => setCreating(true)}>New ticket</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 py-3">
        <select
          value={view}
          onChange={(e) => {
            setPage(1);
            setView(e.target.value);
          }}
          className="rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 outline-none focus:border-brand-500"
        >
          {VIEWS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>

        <form onSubmit={onSearchSubmit} className="flex w-full items-center sm:w-auto">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value.trim() && appliedSearch) setAppliedSearch("");
            }}
            placeholder="Search ticket no., category, order…"
            className="w-full rounded-l-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-72"
          />
          <Button type="submit" variant="secondary" className="-ml-px shrink-0 rounded-l-none">
            Search
          </Button>
        </form>

        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <TicketsTable
        tickets={tickets}
        loading={loading}
        emptyText={
          hasFilters
            ? "No tickets match these filters."
            : view === "admin"
              ? "Our team hasn't raised any tickets for your store."
              : "No tickets yet - raise one from an order, or with New ticket."
        }
        onOpen={setViewing}
      />

      {tickets.length > 0 ? (
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
          // A new ticket is the user's own - land on My Tickets to show it.
          if (view === "mine") load();
          else setView("mine");
        }}
      />
      <TicketDetailDialog ticket={viewing} open={Boolean(viewing)} onClose={() => setViewing(null)} />
    </div>
  );
}
