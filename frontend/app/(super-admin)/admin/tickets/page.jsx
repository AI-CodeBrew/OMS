"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "../../../../components/shared/Button";
import Pagination from "../../../../components/shared/Pagination";
import TicketsTable from "../../../../components/tickets/TicketsTable";
import { TICKET_STATUSES, TICKET_STATUS_LABEL } from "../../../../components/tickets/ticketStatus";
import ticketsAdminService from "../../../../services/ticketsAdminService";
import tenantsService from "../../../../services/tenantsService";
import CreateTicketDialog from "../../../../components/tickets/CreateTicketDialog";

// Cross-org - every organization's tickets. Opening a ticket goes to
// /admin/tickets/[id] (a dedicated page, not an inline accordion) since
// changing its status and replying is enough surface area to deserve its own
// screen rather than fighting the list for space.
// Two views, picked from the dropdown: "My Tickets" (the default) - what
// FynkTech's super admin side raised for stores - and "By Customer", what
// the stores raised (Ticket.ticket_type "admin" / "customer").
const VIEWS = [
  { value: "admin", label: "My Tickets", hint: "Tickets FynkTech has raised for stores." },
  { value: "customer", label: "By Customer", hint: "Every support ticket raised by the stores." },
];

export default function AdminTicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [view, setView] = useState("admin");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [stores, setStores] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await ticketsAdminService.list({
        type: view,
        q: appliedSearch,
        status,
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
  }, [view, appliedSearch, status, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  // The New ticket form's Store list - every store, not just the Hub's.
  useEffect(() => {
    tenantsService
      .listOrganizations()
      .then((data) =>
        setStores(
          (data.organizations || [])
            .map((o) => ({ id: o.id, name: o.name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => {});
  }, []);

  function onSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tickets</h1>
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
            placeholder="Search ticket no., store, order, category…"
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
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <TicketsTable
        tickets={tickets}
        loading={loading}
        emptyText="No tickets match these filters."
        onOpen={(t) => router.push(`/admin/tickets/${t.id}`)}
        showStore
      />

      {tickets.length > 0 ? (
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

      <CreateTicketDialog
        open={creating}
        stores={stores}
        createTicket={(payload) => ticketsAdminService.create(payload)}
        searchStoreOrders={(storeId, q) => ticketsAdminService.searchStoreOrders(storeId, q)}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setPage(1);
          // FynkTech's own ticket - land on My Tickets to show it.
          if (view === "admin") load();
          else setView("admin");
        }}
      />
    </div>
  );
}
