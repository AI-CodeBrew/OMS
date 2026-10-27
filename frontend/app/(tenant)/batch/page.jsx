"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import printBatchService from "../../../services/printBatchService";
import ordersService from "../../../services/ordersService";
import Pagination from "../../../components/shared/Pagination";
import Modal from "../../../components/shared/Modal";
import Button, { Spinner } from "../../../components/shared/Button";
import Checkbox from "../../../components/shared/Checkbox";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import { SMARTLANE_LOAD_SHEET_COURIERS } from "../../../components/orders/statusConfig";
import { DownloadIcon, HistoryIcon, PrinterIcon } from "../../../components/layout/navIcons";
import { orderBookingAccount } from "../../../components/orders/orderBookingAccount";
import barqraftarService from "../integrations/barq-raftar/_lib/barqraftarService";
import postexService from "../integrations/postex/_lib/postexService";

const AirwayBillFilterModal = dynamic(
  () => import("../../../components/orders/AirwayBillFilterModal"),
  { ssr: false }
);

const KIND_FILTERS = [
  { value: "", label: "All Types" },
  { value: "loadsheet", label: "Load Sheet" },
  { value: "airway_bill", label: "Airway Bill" },
];
// Load Sheet reads blue, Airway Bill purple - everywhere a document shows.
const DOCUMENT_KINDS = [
  {
    kind: "loadsheet",
    label: "Load Sheet",
    tile: "border-blue-200 bg-blue-50/60",
    title: "text-blue-800",
    dot: "bg-blue-500",
    icon: "text-blue-600 hover:bg-white hover:text-blue-900 hover:shadow-sm",
  },
  {
    kind: "airway_bill",
    label: "Airway Bill",
    tile: "border-violet-200 bg-violet-50/60",
    title: "text-violet-800",
    dot: "bg-violet-500",
    icon: "text-violet-600 hover:bg-white hover:text-violet-900 hover:shadow-sm",
  },
];
// Shared by Daily Batch and History so every document button is the same
// size and lights up the same way on hover.
const DOC_BUTTON =
  "inline-flex w-32 items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const AIRWAY_BILL_BUTTON = `${DOC_BUTTON} border-violet-200 bg-violet-50/60 text-violet-700 hover:border-violet-300 hover:bg-violet-100 hover:text-violet-800`;
const LOAD_SHEET_BUTTON = `${DOC_BUTTON} border-blue-200 bg-blue-50/60 text-blue-700 hover:border-blue-300 hover:bg-blue-100 hover:text-blue-800`;
const TOGGLE_BUTTON =
  "inline-flex w-32 items-center justify-center gap-1 rounded-md border border-surface-border bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700";

const LOAD_SHEET_COURIERS = SMARTLANE_LOAD_SHEET_COURIERS.filter(
  (c) => !c.disabled && c.value !== "all"
);
const COURIER_LABELS = {
  ...Object.fromEntries(SMARTLANE_LOAD_SHEET_COURIERS.map((c) => [c.value, c.label])),
  postex: "PostEx",
  barqraftar: "BarqRaftar",
};
function courierLabel(value) {
  if (!value) return "";
  return COURIER_LABELS[value] || value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Local calendar day ("YYYY-MM-DD") of an ISO timestamp - History groups
// by the day a batch was created, as the viewer's clock sees it.
function localDay(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// day is a plain "YYYY-MM-DD" string - constructing with a T00:00:00 local
// time (instead of new Date(day), which parses as UTC midnight) avoids the
// date shifting a day backward for anyone west of UTC.
function formatDayLabel(day) {
  const date = new Date(`${day}T00:00:00`);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfToday - date) / 86400000);
  const full = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (diffDays === 0) return { primary: "Today", secondary: full };
  if (diffDays === 1) return { primary: "Yesterday", secondary: full };
  return { primary: date.toLocaleDateString(undefined, { weekday: "long" }), secondary: full };
}

// One document of a batch as a compact tinted chip - its label plus
// download/print icon buttons; when and for how many orders it was
// generated is in the tooltip rather than on screen.
function DocumentChip({ config, doc, batchNumber, busy, onDownload, onPrint }) {
  if (!doc) {
    return (
      <div className="flex h-9 w-full items-center gap-2 rounded-md border border-dashed border-surface-border px-3 text-sm text-slate-400 md:w-48">
        <span className={`h-2 w-2 shrink-0 rounded-full opacity-30 ${config.dot}`} />
        No {config.label.toLowerCase()}
      </div>
    );
  }
  const downloading = busy === `download:${doc.id}`;
  const printing = busy === `print:${doc.id}`;
  return (
    <div
      title={`Generated ${formatDateTime(doc.updated_at)} · ${doc.order_count} order${doc.order_count === 1 ? "" : "s"}${
        doc.courier ? ` · ${courierLabel(doc.courier)}` : ""
      }`}
      className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border pl-3 pr-1 md:w-48 ${config.tile}`}
    >
      <span className={`flex items-center gap-2 text-sm font-medium ${config.title}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${config.dot}`} />
        {config.label}
      </span>
      <span className="flex items-center">
        <button
          type="button"
          onClick={() => onDownload(doc, batchNumber)}
          disabled={downloading}
          aria-label={`Download ${config.label}`}
          title={`Download ${config.label}`}
          className={`flex h-7 w-7 items-center justify-center rounded transition disabled:opacity-50 ${config.icon}`}
        >
          {downloading ? <Spinner /> : <DownloadIcon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => onPrint(doc)}
          disabled={printing}
          aria-label={`Print ${config.label}`}
          title={`Print ${config.label}`}
          className={`flex h-7 w-7 items-center justify-center rounded transition disabled:opacity-50 ${config.icon}`}
        >
          {printing ? <Spinner /> : <PrinterIcon className="h-4 w-4" />}
        </button>
      </span>
    </div>
  );
}

// One batch as one row of its day's list; the chevron opens its orders
// (and removing some of them).
function BatchRow({ batch, showStore, busy, onDownload, onPrint, onRemoveOrders }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const active = batch.entries.filter((e) => !e.removed_at);
  const removed = batch.entries.filter((e) => e.removed_at);
  const preview = active.slice(0, 4).map((e) => e.order_number);
  const allSelected = active.length > 0 && selected.size === active.length;

  function toggle(number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }

  return (
    <li className={`transition ${expanded ? "bg-brand-50/30" : "hover:bg-brand-50/40"}`}>
      <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[8.5rem_7rem_minmax(0,1fr)_auto_2.25rem] md:items-center md:gap-4">
        <div>
          <div className="font-mono text-base font-semibold text-slate-900">{batch.batch_number}</div>
          <div className="text-sm text-slate-500">
            {formatTime(batch.created_at)}
            {showStore && batch.store_name ? ` · ${batch.store_name}` : ""}
          </div>
        </div>

        <div className="text-sm font-medium text-slate-700">
          {batch.courier ? courierLabel(batch.courier) : <span className="text-slate-400">—</span>}
        </div>

        <div className="min-w-0 text-sm">
          <div className="font-medium text-slate-900">
            {batch.order_count} order{batch.order_count === 1 ? "" : "s"}
            {removed.length ? (
              <span className="font-normal text-slate-400"> · {removed.length} removed</span>
            ) : null}
          </div>
          <div className="truncate text-slate-500" title={active.map((e) => e.order_number).join(", ")}>
            {preview.length
              ? `${preview.join(", ")}${active.length > preview.length ? ` +${active.length - preview.length}` : ""}`
              : batch.entries.length
                ? "Every order removed"
                : "By date range"}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {DOCUMENT_KINDS.map((config) => {
            const docs = batch.documents.filter((d) => d.kind === config.kind);
            return docs.length ? (
              <div key={config.kind} className="flex flex-col gap-1">
                {docs.map((doc) => (
                  <DocumentChip
                    key={doc.id}
                    config={config}
                    doc={doc}
                    batchNumber={batch.batch_number}
                    busy={busy}
                    onDownload={onDownload}
                    onPrint={onPrint}
                  />
                ))}
              </div>
            ) : (
              <DocumentChip key={config.kind} config={config} />
            );
          })}
        </div>

        <div className="flex justify-end">
          {batch.entries.length ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "Hide orders" : "Show orders"}
              title={expanded ? "Hide orders" : "Show orders"}
              className={`flex h-9 w-9 items-center justify-center rounded-md border transition ${
                expanded
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-surface-border bg-white text-slate-500 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              }`}
            >
              <span className={`text-xs transition-transform ${expanded ? "rotate-180" : ""}`}>▼</span>
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-surface-border bg-white px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Checkbox
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                disabled={!active.length}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(active.map((e) => e.order_number)))
                }
              />
              Select all
            </label>
            <button
              type="button"
              disabled={!selected.size}
              onClick={() => onRemoveOrders(batch, [...selected], () => setSelected(new Set()))}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-surface-border disabled:text-slate-300 disabled:hover:bg-white"
            >
              Remove from batch{selected.size ? ` (${selected.size})` : ""}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {active.map((e) => (
              <label
                key={e.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition ${
                  selected.has(e.order_number)
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-surface-border text-slate-700 hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-700"
                }`}
              >
                <Checkbox checked={selected.has(e.order_number)} onChange={() => toggle(e.order_number)} />
                {e.order_number}
              </label>
            ))}
            {removed.map((e) => (
              <span
                key={e.id}
                title={`Removed ${formatDateTime(e.removed_at)} - still listed on the documents printed before that`}
                className="rounded-md border border-dashed border-surface-border px-2.5 py-1.5 text-sm text-slate-400 line-through"
              >
                {e.order_number}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function HistorySection() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [kind, setKind] = useState("");
  const [courier, setCourier] = useState("");
  const [couriers, setCouriers] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [batches, setBatches] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "download:<docId>" / "print:<docId>" - one document action at a time.
  const [busy, setBusy] = useState(null);
  // {batch, orderNumbers, onDone} while the remove confirmation is open.
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await printBatchService.listBatches({
        q: appliedSearch,
        kind,
        courier,
        date_from: dateFrom,
        date_to: dateTo,
        page,
        page_size: pageSize,
      });
      setBatches(data.results || []);
      setCount(data.count || 0);
    } catch (err) {
      setError(err.message || "Failed to load batches");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, kind, courier, dateFrom, dateTo, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    printBatchService
      .listBatchCouriers()
      .then(setCouriers)
      .catch(() => setCouriers([]));
  }, []);

  // Results arrive newest first, so grouping in arrival order keeps both
  // the days and the batches inside each day in that order.
  const days = useMemo(() => {
    const groups = [];
    for (const batch of batches) {
      const day = localDay(batch.created_at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.batches.push(batch);
      else groups.push({ day, batches: [batch] });
    }
    return groups;
  }, [batches]);

  // Store names only matter in a multi-store (Dispatch Hub) view.
  const showStore = useMemo(
    () => new Set(batches.map((b) => b.organization_id)).size > 1,
    [batches]
  );

  function onSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  async function runDocumentAction(key, fn) {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message || "Download failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setError("");
    try {
      const updated = await printBatchService.removeOrders(removing.batch.id, removing.orderNumbers);
      setBatches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      removing.onDone?.();
    } catch (err) {
      setError(err.message || "Failed to remove orders");
    } finally {
      setRemoving(null);
      setRemoveBusy(false);
    }
  }

  const removeCount = removing?.orderNumbers.length || 0;

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={onSearchSubmit}
          className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number…"
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-56"
          />
          <button
            type="submit"
            className="rounded-md border border-surface-border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface"
          >
            Search
          </button>
        </form>

        <select
          value={kind}
          onChange={(e) => {
            setPage(1);
            setKind(e.target.value);
          }}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={courier}
          onChange={(e) => {
            setPage(1);
            setCourier(e.target.value);
          }}
          className="rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">All Couriers</option>
          {couriers.map((c) => (
            <option key={c} value={c}>
              {courierLabel(c)}
            </option>
          ))}
        </select>

        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApplyDateRange={(from, to) => {
            setPage(1);
            setDateFrom(from);
            setDateTo(to);
          }}
          onClearDateRange={() => {
            setPage(1);
            setDateFrom("");
            setDateTo("");
          }}
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-4 space-y-5">
        {loading ? (
          <div className="rounded-lg border border-surface-border bg-white px-4 py-6 text-center text-sm text-slate-500">
            Loading…
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-lg border border-surface-border bg-white px-4 py-6 text-center text-sm text-slate-500">
            {appliedSearch || kind || courier || dateFrom || dateTo
              ? "No batches match these filters."
              : "No batches yet - generate a load sheet or airway bill from Daily Batch or the Orders page."}
          </div>
        ) : (
          days.map(({ day, batches: dayBatches }) => {
            const label = formatDayLabel(day);
            return (
              <section key={day}>
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <h2 className="text-base font-semibold text-slate-900">{label.primary}</h2>
                  <span className="text-sm text-slate-500">{label.secondary}</span>
                  <span className="ml-auto text-sm text-slate-500">
                    {dayBatches.length} batch{dayBatches.length === 1 ? "" : "es"}
                  </span>
                </div>
                <ul className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-white">
                  {dayBatches.map((batch) => (
                    <BatchRow
                      key={batch.id}
                      batch={batch}
                      showStore={showStore}
                      busy={busy}
                      onDownload={(doc, batchNumber) =>
                        runDocumentAction(`download:${doc.id}`, () =>
                          printBatchService.download(doc, batchNumber)
                        )
                      }
                      onPrint={(doc) =>
                        runDocumentAction(`print:${doc.id}`, () => printBatchService.print(doc))
                      }
                      onRemoveOrders={(b, orderNumbers, onDone) =>
                        setRemoving({ batch: b, orderNumbers, onDone })
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <div className="mt-3">
        <Pagination
          page={page}
          pageSize={pageSize}
          count={count}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      <Modal
        open={Boolean(removing)}
        onClose={() => {
          if (!removeBusy) setRemoving(null);
        }}
        title={`Remove from ${removing?.batch.batch_number || "batch"}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={removeBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRemove} loading={removeBusy}>
              Remove {removeCount} order{removeCount === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          {removing?.orderNumbers.join(", ")} will be taken out of this batch.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          The orders themselves aren&apos;t changed, and the load sheet and airway bill already
          generated stay exactly as they were printed - they&apos;ll still list these orders.
        </p>
      </Modal>
    </>
  );
}

// Each day's orders split by the integration that booked them - BarqRaftar's
// and PostEx's documents only ever cover their own parcels, so every
// courier gets its own pair of buttons, calling the same services the
// Orders page's print actions do. Smartlane only shows up on a day that
// actually has Smartlane-booked orders.
const DAILY_COURIERS = [
  {
    key: "postex",
    label: "PostEx",
    accounts: ["postex"],
    airwayBill: (ids) => postexService.printAirwayBills(ids),
    loadSheet: (ids) => postexService.printLoadSheet(ids),
  },
  {
    key: "barqraftar",
    label: "BarqRaftar",
    accounts: ["barqraftar"],
    airwayBill: (ids) => barqraftarService.printLabels(ids),
    loadSheet: (ids) => barqraftarService.printLoadSheet(ids),
  },
  {
    key: "smartlane",
    label: "Smartlane",
    accounts: ["smartlane", "oms_courier"],
    smartlane: true,
  },
];

function splitByCourier(orders) {
  const groups = DAILY_COURIERS.map((courier) => ({ courier, orders: [] }));
  let unbooked = 0;
  for (const order of orders) {
    const account = orderBookingAccount(order);
    const group = groups.find((g) => g.courier.accounts.includes(account));
    if (group) group.orders.push(order);
    else unbooked += 1;
  }
  return { groups: groups.filter((g) => g.orders.length), unbooked };
}

// One courier's share of a day. Both buttons cover every order unless
// some are ticked under "Orders ▾" - then only those (e.g. reprinting a
// few spoiled waybills).
function DailyCourierGroup({
  courier,
  orders,
  busy,
  busyKeyBase,
  smartlaneCourier,
  onSmartlaneCourierChange,
  onAirwayBill,
  onLoadSheet,
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const picked = selected.size ? orders.filter((o) => selected.has(o.id)) : orders;
  const countLabel = selected.size ? ` (${selected.size})` : "";
  const allSelected = selected.size === orders.length;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-md border border-surface-border bg-white transition hover:border-brand-200 hover:bg-brand-50/40">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        {/* Fixed-width name and count columns so every row's Orders button
            lines up, whatever the courier's name length. */}
        <div className="flex items-center gap-3 text-sm">
          <span className="w-24 font-semibold text-slate-900">{courier.label}</span>
          <span className="w-24 text-slate-500">
            {orders.length} order{orders.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className={TOGGLE_BUTTON}
          >
            {expanded ? "Hide orders ▴" : "Orders ▾"}
          </button>
          {selected.size ? (
            <span className="font-medium text-brand-700">{selected.size} selected</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onAirwayBill(picked)}
            disabled={Boolean(busy)}
            className={AIRWAY_BILL_BUTTON}
          >
            {busy === `${busyKeyBase}:airway_bill` ? "Generating…" : `Airway Bill${countLabel}`}
          </button>
          {courier.smartlane ? (
            <select
              value={smartlaneCourier}
              onChange={(e) => onSmartlaneCourierChange(e.target.value)}
              className="rounded-md border border-surface-border bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-500"
            >
              <option value="">Courier…</option>
              {LOAD_SHEET_COURIERS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={() => onLoadSheet(picked)}
            disabled={Boolean(busy) || (courier.smartlane && !smartlaneCourier)}
            className={LOAD_SHEET_BUTTON}
          >
            {busy === `${busyKeyBase}:loadsheet` ? "Generating…" : `Load Sheet${countLabel}`}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-surface-border bg-white px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Checkbox
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)))}
              />
              Select all
            </label>
            <span className="text-sm text-slate-500">
              {selected.size
                ? "Buttons print only the ticked orders."
                : "Nothing ticked - buttons print every order."}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {orders.map((o) => (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition ${
                  selected.has(o.id)
                    ? "border-brand-300 bg-brand-50 text-brand-800"
                    : "border-surface-border text-slate-700 hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-700"
                }`}
              >
                <Checkbox checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                {o.order_number}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DailyBatchSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // "<date>:<courier>:<kind>" of the document being generated.
  const [busy, setBusy] = useState(null);
  // Smartlane only: its load sheet is per courier, picked per day.
  const [smartlaneCourierByDate, setSmartlaneCourierByDate] = useState({});
  const [airwayBillOrders, setAirwayBillOrders] = useState(null);
  // {day, courier, orders} while the load sheet confirmation is open.
  const [confirmLoadSheet, setConfirmLoadSheet] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await printBatchService.listDaily({ date_from: dateFrom, date_to: dateTo });
      setDays(data || []);
    } catch (err) {
      setError(err.message || "Failed to load daily batches");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate(key, fn, doneMessage) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(doneMessage);
    } catch (err) {
      setError(err.message || "Print failed");
    } finally {
      setBusy(null);
    }
  }

  function onAirwayBill(day, { courier, orders }) {
    if (courier.smartlane) {
      setAirwayBillOrders(orders);
      return;
    }
    generate(
      `${day.date}:${courier.key}:airway_bill`,
      () => courier.airwayBill(orders.map((o) => o.id)),
      `${courier.label} airway bill downloaded - saved to History.`
    );
  }

  function onConfirmLoadSheet() {
    const { day, courier, orders } = confirmLoadSheet;
    setConfirmLoadSheet(null);
    const ids = orders.map((o) => o.id);
    generate(
      `${day.date}:${courier.key}:loadsheet`,
      () =>
        courier.smartlane
          ? ordersService.printSmartlaneLoadSheet(ids, smartlaneCourierByDate[day.date])
          : courier.loadSheet(ids),
      `${courier.label} load sheet downloaded - saved to History.`
    );
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApplyDateRange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
          onClearDateRange={() => {
            setDateFrom("");
            setDateTo("");
          }}
        />
        {!dateFrom && !dateTo ? (
          <span className="text-sm text-slate-500">Showing the last 30 days</span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-md bg-green-50 px-4 py-2.5 text-sm text-green-700">{notice}</p>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-lg border border-surface-border bg-white">
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : days.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            No orders have reached Ready to Print in this range yet.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {days.map((day) => {
              const label = formatDayLabel(day.date);
              const { groups, unbooked } = splitByCourier(day.orders);
              return (
                <li key={day.date} className="flex flex-col gap-4 px-5 py-4 transition hover:bg-surface/60 md:flex-row md:items-start">
                  {/* pt-2.5 lines the date up with the first courier row's text. */}
                  <div className="flex shrink-0 items-baseline justify-between gap-4 md:w-48 md:flex-col md:justify-start md:gap-1 md:pt-2.5">
                    <div>
                      <div className="text-base font-semibold text-slate-900">{label.primary}</div>
                      <div className="text-sm text-slate-500">{label.secondary}</div>
                    </div>
                    <div className="text-sm text-slate-600">
                      <span className="text-base font-semibold text-slate-900">{day.order_count}</span>{" "}
                      order{day.order_count === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    {groups.map(({ courier, orders }) => (
                      <DailyCourierGroup
                        key={courier.key}
                        courier={courier}
                        orders={orders}
                        busy={busy}
                        busyKeyBase={`${day.date}:${courier.key}`}
                        smartlaneCourier={smartlaneCourierByDate[day.date] || ""}
                        onSmartlaneCourierChange={(value) =>
                          setSmartlaneCourierByDate((prev) => ({ ...prev, [day.date]: value }))
                        }
                        onAirwayBill={(printOrders) => onAirwayBill(day, { courier, orders: printOrders })}
                        onLoadSheet={(printOrders) =>
                          setConfirmLoadSheet({ day, courier, orders: printOrders })
                        }
                      />
                    ))}
                    {unbooked ? (
                      <p className="px-4 text-sm text-slate-500">
                        {groups.length ? "+ " : ""}
                        {unbooked} order{unbooked === 1 ? "" : "s"} not booked through PostEx or BarqRaftar - no
                        documents to generate here.
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        open={Boolean(confirmLoadSheet)}
        onClose={() => setConfirmLoadSheet(null)}
        title={`Generate ${confirmLoadSheet?.courier.label || ""} load sheet?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmLoadSheet(null)}>
              Cancel
            </Button>
            <Button onClick={onConfirmLoadSheet}>Generate</Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Load sheet for {confirmLoadSheet?.orders.length} order
          {confirmLoadSheet?.orders.length === 1 ? "" : "s"} from{" "}
          {confirmLoadSheet ? formatDayLabel(confirmLoadSheet.day.date).secondary : ""}.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          This hands the parcels over to the courier - the orders move to Awaiting Dispatched.
          {confirmLoadSheet?.courier.key === "postex"
            ? " PostEx makes a load sheet only once per parcel; parcels already on one come back as the copy saved then."
            : ""}
        </p>
      </Modal>

      <AirwayBillFilterModal orders={airwayBillOrders} onClose={() => setAirwayBillOrders(null)} />
    </>
  );
}

export default function BatchPage() {
  // Daily Batch is the page itself; History opens from the icon in the
  // top-right corner and closes back to it.
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Batch</h1>
          <p className="mt-1 text-sm text-slate-500">
            {showHistory
              ? "Every batch ever printed, by day - its load sheet and airway bill side by side, re-downloaded or reprinted exactly as generated, never regenerated."
              : "Every order that reached Ready to Print, grouped by day - (re-)generate an airway bill or load sheet for the whole day, whether or not anyone has printed one yet."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-pressed={showHistory}
          aria-label={showHistory ? "Back to Daily Batch" : "Batch history"}
          title={showHistory ? "Back to Daily Batch" : "Batch history"}
          className={`shrink-0 rounded-md border p-2 transition ${
            showHistory
              ? "border-brand-700 bg-brand-800 text-white"
              : "border-surface-border bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <HistoryIcon className="h-5 w-5" />
        </button>
      </div>

      {showHistory ? <HistorySection /> : <DailyBatchSection />}
    </div>
  );
}
