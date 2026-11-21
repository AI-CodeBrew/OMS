"use client";

import { useCallback, useEffect, useState } from "react";
import usePageAccess from "../../../../lib/usePageAccess";
import wmsService from "../../../../services/wmsService";
import Button from "../../../../components/shared/Button";
import SimpleFormModal from "../../../../components/wms/purchase-orders/SimpleFormModal";
import { formatDate } from "../../../../lib/formatDate";

// Same fields as Add Warehouse on the Purchase Orders page.
const WAREHOUSE_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "city", label: "City" },
  { key: "address", label: "Address" },
  { key: "poc_name", label: "POC name" },
  { key: "poc_phone", label: "POC number" },
  { key: "remark", label: "Remark", multiline: true },
];

function StatCard({ label, value, tone = "default", hint }) {
  const tones = { default: "text-slate-900", warning: "text-red-600" };
  return (
    <div
      title={hint}
      className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-white px-3 py-1.5"
    >
      <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</span>
    </div>
  );
}

const num = (n) => Number(n || 0).toLocaleString();

// IMS > Warehouses: every warehouse of this store's inventory (an
// organization's stores share the main store's), with its stock and
// purchase-order totals (backend: WarehouseViewSet.summary). Add and edit
// details here; code, default and active stay as they are.
export default function WarehousesPage() {
  const inventory = usePageAccess("ims.inventory");
  const purchase = usePageAccess("ims.purchase_orders");
  const canWrite = inventory.canWrite || purchase.canWrite;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await wmsService.warehousesSummary());
    } catch (err) {
      setError(err.message || "Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = rows.reduce(
    (t, w) => ({
      products: t.products + (w.products || 0),
      units: t.units + (w.units_on_hand || 0),
      belowZero: t.belowZero + (w.products_below_zero || 0),
    }),
    { products: 0, units: 0, belowZero: 0 }
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1
          className="text-2xl font-semibold text-slate-900"
          title="Where your stock is kept. Purchase orders are received into a warehouse; its products are on the Inventory page."
        >
          Warehouses
        </h1>
        <div className="flex flex-wrap gap-2">
          {canWrite ? <Button onClick={() => setAdding(true)}>Add Warehouse</Button> : null}
          <Button variant="secondary" loading={loading} onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Warehouses" value={num(rows.length)} />
        <StatCard label="Products" value={num(totals.products)} hint="Stock rows across all warehouses" />
        <StatCard
          label="Units on hand"
          value={num(totals.units)}
          hint="Available units - products below zero are not taken off"
        />
        <StatCard
          label="Below zero"
          value={num(totals.belowZero)}
          tone={totals.belowZero ? "warning" : "default"}
          hint="Products whose Available is under 0 - more went out than came in on purchase orders"
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-surface-border bg-surface text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Warehouse</th>
              <th className="px-3 py-2 text-left">Address</th>
              <th className="px-3 py-2 text-left">Contact</th>
              <th className="px-3 py-2 text-right">Products</th>
              <th className="px-3 py-2 text-right" title="Available units - products below zero are not taken off">
                Units on hand
              </th>
              <th className="px-3 py-2 text-right" title="Products whose Available is under 0">
                Below zero
              </th>
              <th className="px-3 py-2 text-right">POs</th>
              <th className="px-3 py-2 text-right" title="Units received on purchase orders: good (damaged)">
                Received
              </th>
              <th className="px-3 py-2 text-left">Last PO</th>
              {canWrite ? <th className="px-3 py-2 text-right">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                  No warehouses yet.
                </td>
              </tr>
            ) : (
              rows.map((w) => (
                <tr key={w.id} className="border-b border-surface-border align-top last:border-0">
                  <td className="px-3 py-2 tabular-nums text-slate-600">{w.code}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-900">{w.name}</span>
                      {w.is_default ? (
                        <span
                          className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                          title="Orders' stock is checked and taken from this warehouse"
                        >
                          Default
                        </span>
                      ) : null}
                      {!w.is_active ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          Inactive
                        </span>
                      ) : null}
                    </div>
                    {w.remark ? <div className="mt-0.5 text-xs text-slate-500">{w.remark}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {w.address || w.city ? (
                      <>
                        {w.address ? <div>{w.address}</div> : null}
                        {w.city ? <div className="text-xs text-slate-500">{w.city}</div> : null}
                      </>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {w.poc_name || w.poc_phone ? (
                      <>
                        {w.poc_name ? <div>{w.poc_name}</div> : null}
                        {w.poc_phone ? <div className="text-xs text-slate-500">{w.poc_phone}</div> : null}
                      </>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(w.products)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(w.units_on_hand)}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      w.products_below_zero ? "font-medium text-red-600" : "text-slate-500"
                    }`}
                  >
                    {num(w.products_below_zero)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(w.purchase_orders)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {num(w.good_received)}
                    {w.damaged_received ? (
                      <span className="text-xs text-red-600"> ({num(w.damaged_received)} dmg)</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {w.last_purchase_order_at ? formatDate(w.last_purchase_order_at) : "-"}
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(w)}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SimpleFormModal
        open={adding}
        title="Add Warehouse"
        fields={WAREHOUSE_FIELDS}
        submitLabel="Add Warehouse"
        onClose={() => setAdding(false)}
        onSubmit={async (values) => {
          await wmsService.addWarehouse(values);
          setAdding(false);
          setNotice(`Warehouse ${values.name} added.`);
          load();
        }}
      />
      <SimpleFormModal
        open={Boolean(editing)}
        title={editing ? `Edit Warehouse ${editing.code}` : "Edit Warehouse"}
        fields={WAREHOUSE_FIELDS}
        initial={editing}
        submitLabel="Save"
        onClose={() => setEditing(null)}
        onSubmit={async (values) => {
          await wmsService.updateWarehouse(editing.id, values);
          setEditing(null);
          setNotice(`Warehouse ${values.name} saved.`);
          load();
        }}
      />
    </div>
  );
}
