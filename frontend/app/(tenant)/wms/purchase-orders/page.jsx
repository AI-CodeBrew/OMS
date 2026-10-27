"use client";

import { useCallback, useEffect, useState } from "react";
import wmsService from "../../../../services/wmsService";
import Button from "../../../../components/shared/Button";
import Pagination from "../../../../components/shared/Pagination";
import SimpleFormModal from "../../../../components/wms/purchase-orders/SimpleFormModal";
import AddPurchaseOrderModal from "../../../../components/wms/purchase-orders/AddPurchaseOrderModal";
import ReceivePurchaseOrderModal from "../../../../components/wms/purchase-orders/ReceivePurchaseOrderModal";

const SUPPLIER_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
];

const WAREHOUSE_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "city", label: "City" },
  { key: "address", label: "Address" },
  { key: "poc_name", label: "POC name" },
  { key: "poc_phone", label: "POC number" },
  { key: "remark", label: "Remark", multiline: true },
];

// A PO's state is worked out from its lines (backend: wms.services.
// purchase_order_state) - the cards and the table's badge agree.
const STATE_BADGE = {
  received: { label: "Received", className: "bg-green-100 text-green-700" },
  partial: { label: "Partially Received", className: "bg-amber-100 text-amber-700" },
  not_received: { label: "Not Received", className: "bg-slate-100 text-slate-600" },
};

function SummaryCard({ label, value, tone = "default", active, onClick }) {
  const tones = {
    default: "text-slate-900",
    success: "text-green-600",
    warning: "text-amber-600",
    muted: "text-slate-500",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border bg-white p-4 text-left transition ${
        active ? "border-brand-800 ring-1 ring-brand-800" : "border-surface-border hover:bg-surface"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
    </button>
  );
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState({});
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [openForm, setOpenForm] = useState(null); // "po" | "supplier" | "warehouse"
  const [receiving, setReceiving] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, summaryData] = await Promise.all([
        wmsService.listPurchaseOrders({
          state: state || undefined,
          search: appliedSearch || undefined,
          page,
          page_size: pageSize,
        }),
        wmsService.purchaseOrderSummary(),
      ]);
      setOrders(data.results || []);
      setCount(data.count || 0);
      setSummary(summaryData);
    } catch (err) {
      setError(err.message || "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  }, [state, appliedSearch, page, pageSize]);

  const loadLists = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([wmsService.listSuppliers(), wmsService.listWarehouses()]);
      setSuppliers(s);
      setWarehouses(w);
    } catch (err) {
      setError(err.message || "Failed to load suppliers and warehouses");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  function applyState(value) {
    setState(value);
    setPage(1);
  }

  async function syncShopify() {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const r = await wmsService.syncPurchaseOrderProducts();
      setNotice(
        `Synced ${r.total_skus ?? 0} products from Shopify (${r.created ?? 0} new) - ${r.images_updated ?? 0} images updated.`
      );
    } catch (err) {
      setError(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Purchase Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock bought from suppliers. Good units received are added to the receiving warehouse&apos;s stock.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={syncing} onClick={syncShopify}>
            Sync from Shopify
          </Button>
          <Button variant="secondary" onClick={() => setOpenForm("supplier")}>
            Add Supplier
          </Button>
          <Button variant="secondary" onClick={() => setOpenForm("warehouse")}>
            Add Warehouse
          </Button>
          <Button onClick={() => setOpenForm("po")}>Add PO</Button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total POs" value={summary.total ?? 0} active={state === ""} onClick={() => applyState("")} />
        <SummaryCard
          label="Received"
          value={summary.received ?? 0}
          tone="success"
          active={state === "received"}
          onClick={() => applyState("received")}
        />
        <SummaryCard
          label="Not Received"
          value={summary.not_received ?? 0}
          tone="muted"
          active={state === "not_received"}
          onClick={() => applyState("not_received")}
        />
        <SummaryCard
          label="Partially Received"
          value={summary.partial ?? 0}
          tone="warning"
          active={state === "partial"}
          onClick={() => applyState("partial")}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedSearch(search.trim());
          setPage(1);
        }}
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search PO number, supplier or SKU"
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 sm:w-72"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="mt-3 overflow-x-auto rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">PO Number</th>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-right">Products</th>
              <th className="px-3 py-2 text-right">Total Qty</th>
              <th className="px-3 py-2 text-right">Received Qty</th>
              <th className="px-3 py-2 text-left">Warehouse</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  No purchase orders{state ? " here" : " yet"}.
                </td>
              </tr>
            ) : (
              orders.map((po) => {
                const badge = STATE_BADGE[po.state] || STATE_BADGE.not_received;
                const open = expanded === po.id;
                return [
                  <tr key={po.id} className="border-b border-surface-border">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : po.id)}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {po.po_number}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{po.supplier_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{po.product_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{po.total_quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {po.received_quantity}
                      {po.damaged_quantity ? (
                        <span className="text-xs text-red-600"> ({po.damaged_quantity} dmg)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{po.warehouse_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                      {new Date(po.ordered_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {po.state !== "received" ? (
                        <button
                          type="button"
                          onClick={() => setReceiving(po)}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Receive
                        </button>
                      ) : null}
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${po.id}-lines`} className="border-b border-surface-border bg-surface/50">
                      <td colSpan={9} className="px-3 py-2">
                        <table className="w-full text-xs">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="py-1 text-left">Product</th>
                              <th className="py-1 text-right">Ordered</th>
                              <th className="py-1 text-right">Price</th>
                              <th className="py-1 text-right">Good</th>
                              <th className="py-1 text-right">Damaged</th>
                            </tr>
                          </thead>
                          <tbody>
                            {po.lines.map((line) => (
                              <tr key={line.id}>
                                <td className="py-1">
                                  <div className="flex items-center gap-2">
                                    {line.image_url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={line.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                                    ) : null}
                                    <span className="font-medium text-slate-800">{line.sku}</span>
                                    <span className="text-slate-500">{line.product_name}</span>
                                  </div>
                                </td>
                                <td className="py-1 text-right tabular-nums">{line.quantity_ordered}</td>
                                <td className="py-1 text-right tabular-nums">{line.unit_price}</td>
                                <td className="py-1 text-right tabular-nums text-green-700">{line.good_received}</td>
                                <td className="py-1 text-right tabular-nums text-red-700">{line.damaged_received}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-1 text-xs text-slate-500">Total cost: {po.total_cost}</p>
                      </td>
                    </tr>
                  ) : null,
                ];
              })
            )}
          </tbody>
        </table>
      </div>

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

      <AddPurchaseOrderModal
        open={openForm === "po"}
        suppliers={suppliers}
        warehouses={warehouses}
        onClose={() => setOpenForm(null)}
        onCreated={() => {
          setOpenForm(null);
          setNotice("Purchase order added.");
          load();
        }}
      />
      <SimpleFormModal
        open={openForm === "supplier"}
        title="Add Supplier"
        fields={SUPPLIER_FIELDS}
        submitLabel="Add Supplier"
        onClose={() => setOpenForm(null)}
        onSubmit={async (values) => {
          await wmsService.addSupplier(values);
          setOpenForm(null);
          setNotice(`Supplier ${values.name} added.`);
          loadLists();
        }}
      />
      <SimpleFormModal
        open={openForm === "warehouse"}
        title="Add Warehouse"
        fields={WAREHOUSE_FIELDS}
        submitLabel="Add Warehouse"
        onClose={() => setOpenForm(null)}
        onSubmit={async (values) => {
          await wmsService.addWarehouse(values);
          setOpenForm(null);
          setNotice(`Warehouse ${values.name} added.`);
          loadLists();
        }}
      />
      <ReceivePurchaseOrderModal
        po={receiving}
        onClose={() => setReceiving(null)}
        onReceived={() => {
          setNotice(`${receiving.po_number} received.`);
          setReceiving(null);
          load();
        }}
      />
    </div>
  );
}
