"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import wmsService from "../../services/wmsService";

const PAGE_SIZE = 10;

const STATUS_PILL = {
  delivered: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-700",
  returned: "bg-red-50 text-red-700",
  attempt: "bg-amber-50 text-amber-700",
  dispatched: "bg-indigo-50 text-indigo-700",
  out_for_delivery: "bg-indigo-50 text-indigo-700",
};

function fmtDate(value) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function fmtDateTime(value) {
  return value
    ? new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
    : "—";
}

// 1 2 … 9 around the current page, like the orders list.
function pageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [...new Set([1, 2, total - 1, total, current - 1, current, current + 1])]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

function Pager({ page, total, onChange }) {
  if (total <= 1) return null;
  const btn = "h-8 min-w-8 rounded-md border px-2.5 text-sm transition disabled:opacity-40";
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className={`${btn} border-surface-border bg-white text-slate-600 hover:bg-surface`}
      >
        ‹ Previous
      </button>
      {pageList(page, total).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-slate-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`${btn} ${
              p === page
                ? "border-brand-700 bg-brand-700 font-semibold text-white"
                : "border-surface-border bg-white text-slate-700 hover:bg-surface"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        disabled={page === total}
        onClick={() => onChange(page + 1)}
        className={`${btn} border-surface-border bg-white text-slate-600 hover:bg-surface`}
      >
        Next ›
      </button>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
    </svg>
  );
}

const TH = "whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-slate-500";
const TD = "whitespace-nowrap px-4 py-3.5 text-sm";

// Each tab's table: columns as [header, cell renderer, right-aligned?].
const TABS = [
  {
    key: "orders",
    label: "Orders",
    empty: "No orders for this item.",
    columns: [
      ["Order ID", (o) => <span className="font-medium text-brand-700">{o.order_number}</span>],
      ["Customer", (o) => <span className="text-slate-700">{o.customer_name || "—"}</span>],
      ["Order Date", (o) => <span className="text-slate-600">{fmtDate(o.date)}</span>],
      ["Created At", (o) => <span className="text-slate-600">{fmtDate(o.created_at)}</span>],
      ["Total", (o) => <span className="tabular-nums text-slate-800">{o.total}</span>, true],
      ["Courier Name", (o) => <span className="text-slate-600">{o.courier || "N/A"}</span>],
      ["Courier Tracking ID", (o) => <span className="text-slate-600">{o.tracking_number || "N/A"}</span>],
      [
        "Status",
        (o) => (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              o.returning ? "bg-red-50 text-red-700" : STATUS_PILL[o.status] || "bg-slate-100 text-slate-600"
            }`}
          >
            {o.returning ? "Return in Transit" : o.status_label}
          </span>
        ),
      ],
      ["Qty", (o) => <span className="tabular-nums text-slate-800">{o.quantity}</span>, true],
    ],
  },
  {
    key: "purchases",
    label: "Purchase Orders",
    empty: "No purchase orders for this item.",
    columns: [
      ["PO Number", (p) => <span className="font-medium text-brand-700">{p.po_number}</span>],
      ["Supplier", (p) => <span className="text-slate-700">{p.supplier}</span>],
      ["Date", (p) => <span className="text-slate-600">{fmtDate(p.ordered_at)}</span>],
      ["Ordered", (p) => <span className="tabular-nums">{p.quantity_ordered}</span>, true],
      ["Good", (p) => <span className="tabular-nums text-green-700">{p.good}</span>, true],
      ["Damaged", (p) => <span className="tabular-nums text-red-700">{p.damaged}</span>, true],
      ["Unit Price", (p) => <span className="tabular-nums">{p.unit_price}</span>, true],
    ],
  },
  {
    key: "movements",
    label: "Stock History",
    empty: "No stock movements yet.",
    columns: [
      ["Date", (m) => <span className="text-slate-600">{fmtDateTime(m.date)}</span>],
      ["Reason", (m) => <span className="text-slate-700">{m.reason}</span>],
      [
        "Change",
        (m) => (
          <span className={`font-medium tabular-nums ${m.delta < 0 ? "text-red-700" : "text-green-700"}`}>
            {m.delta > 0 ? `+${m.delta}` : m.delta}
          </span>
        ),
        true,
      ],
      ["Balance", (m) => <span className="tabular-nums text-slate-800">{m.balance_after}</span>, true],
      ["Reference", (m) => <span className="text-slate-600">{m.reference || m.note || "—"}</span>],
    ],
  },
];

// The Inventory table's eye icon: the item's orders (and its purchase
// orders and stock history), page by page, with the whole lot as a CSV
// (backend: wms.views.StockItemViewSet.report).
export default function InventoryItemDetailModal({ item, onClose }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("orders");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!item) return;
    setReport(null);
    setError("");
    setTab("orders");
    setPage(1);
    wmsService
      .inventoryReport(item.id)
      .then(setReport)
      .catch((err) => setError(err.message || "Failed to load details"));
  }, [item]);

  const active = TABS.find((t) => t.key === tab);
  const rows = useMemo(() => (report ? report[tab] || [] : []), [report, tab]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!item) return null;

  async function download() {
    setDownloading(true);
    setError("");
    try {
      const name = (item.sku || item.product_name || "item").replace(/[^a-z0-9-_]+/gi, "_");
      await wmsService.downloadInventoryReport(item.id, `inventory_${name}.csv`);
    } catch (err) {
      setError(err.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const title = [item.product_name, item.sku].filter(Boolean).join(" · ") || "Item";

  return (
    <Modal open title={title} onClose={onClose} width="max-w-6xl">
      <div className="flex gap-1 border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-brand-700 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {report ? <span className="ml-1.5 text-xs text-slate-400">{(report[t.key] || []).length}</span> : null}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-3 overflow-x-auto rounded-lg border border-surface-border">
        <table className="w-full">
          <thead className="border-b border-surface-border bg-white">
            <tr>
              {active.columns.map(([header, , right]) => (
                <th key={header} className={`${TH} ${right ? "text-right" : ""}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!report ? (
              <tr>
                <td colSpan={active.columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {error ? "—" : "Loading…"}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={active.columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {active.empty}
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr key={i} className="border-b border-surface-border last:border-0 hover:bg-surface/60">
                  {active.columns.map(([header, render, right]) => (
                    <td key={header} className={`${TD} ${right ? "text-right" : ""}`}>
                      {render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button loading={downloading} onClick={download}>
          {!downloading ? <DownloadIcon /> : null}
          Download CSV
        </Button>
        <Pager page={page} total={totalPages} onChange={setPage} />
      </div>
    </Modal>
  );
}
