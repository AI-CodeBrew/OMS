"use client";

import { useEffect, useRef, useState } from "react";
import EditableField from "../../shared/EditableField";
import ordersService from "../../../services/ordersService";
import FynkTechDispatchTag from "../FynkTechDispatchTag";
import TrackingLink from "../../shared/TrackingLink";
import { ReplacementMark, TicketMark } from "../OrdersTable";

// The order's discount is edited once, in the money summary below the
// items - not per item.
// SKU is the product's code (OrderItem.barcode) - from Shopify, or the
// organization's product list; what's typed here is kept on Save.
const ITEM_FIELDS = [
  ["product_name", "Product", "text"],
  ["barcode", "SKU", "text"],
  ["unit_price", "Price", "number"],
  ["quantity", "Qty", "number"],
];

// A product added in Edit (user, 2026-11-25): blank until typed; `_new`
// marks it for the checks on Save (OrderDetailPanel) and `_key` keeps its
// row steady. Saved like the others - the backend recreates the whole list.
let newItemSeq = 0;
function newItem() {
  newItemSeq += 1;
  return { product_name: "", barcode: "", unit_price: "", quantity: 1, pack_units: 1, _new: true, _key: `new-${newItemSeq}` };
}

// Line items edit through the detail panel's single Edit (draft.items),
// saved together with every other field - no per-item Edit/Save here.
export default function LineItemsTab({ order, draft, editing, onChange }) {
  const items = editing ? draft.items : order.items;
  const listId = `order-${order.id}-products`;
  // Product name / SKU suggestions from the store's product list, like New
  // Order: a name fills its SKU and an SKU its name - only into a blank box
  // or one filled this way before, never over what was typed.
  const [hints, setHints] = useState([]);
  const lookupTimer = useRef(null);
  const [focusKey, setFocusKey] = useState(null);
  useEffect(() => () => clearTimeout(lookupTimer.current), []);
  // The lookup answers after more typing - it must change the latest list.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function lookupProduct(index, field, value) {
    clearTimeout(lookupTimer.current);
    const q = (value || "").trim();
    if (q.length < 2) return;
    lookupTimer.current = setTimeout(async () => {
      const results = await ordersService.productLookup({ q, organization_id: order.organization_id });
      setHints(results);
      const low = q.toLowerCase();
      const exact = results.find((r) =>
        field === "product_name" ? r.product_name.toLowerCase() === low : r.sku && r.sku.toLowerCase() === low
      );
      if (!exact) return;
      onChange(
        "items",
        draftRef.current.items.map((item, i) => {
          if (i !== index) return item;
          if (field === "product_name" && exact.sku && (!item.barcode || item._autoSku)) {
            return { ...item, barcode: exact.sku, _autoSku: true };
          }
          if (field === "barcode" && (!item.product_name || item._autoName)) {
            return { ...item, product_name: exact.product_name, _autoName: true };
          }
          return item;
        })
      );
    }, 300);
  }

  function onItemChange(index, field, value) {
    onChange(
      "items",
      draft.items.map((item, i) =>
        i === index
          ? {
              ...item,
              [field]: value,
              // Typed by hand now - no longer the auto-filled one.
              ...(field === "product_name" ? { _autoName: false } : {}),
              ...(field === "barcode" ? { _autoSku: false } : {}),
            }
          : item
      )
    );
    if (field === "product_name" || field === "barcode") lookupProduct(index, field, value);
  }

  // Adds a blank product at the end (on Save it joins the order; its price
  // goes on the total).
  function onItemAdd() {
    const item = newItem();
    setFocusKey(item._key);
    onChange("items", [...draft.items, item]);
  }

  // The bin: takes the product off the order (on Save). The total follows -
  // its price comes off, everything else stays. The last product can't go.
  function onItemRemove(index) {
    const item = draft.items[index];
    const blank = item._new && !(item.product_name || "").trim();
    if (
      !blank &&
      !window.confirm(`Remove "${item.product_name}" from this order? Its price comes off the total when you Save.`)
    ) {
      return;
    }
    onChange(
      "items",
      draft.items.filter((_, i) => i !== index)
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 rounded-md bg-brand-800 px-4 py-3 text-sm text-white sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">OMS Order ID</div>
          {order.supabase_order_no ?? "N/A"}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Store Order ID</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {order.order_number}
            <ReplacementMark order={order} onDark />
            <TicketMark order={order} onDark />
          </div>
          {order.recreate_type === "replacement" && order.recreated_from_number ? (
            <div className="mt-0.5 text-[11px] text-brand-100">
              Replacement for {order.recreated_from_number}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Location</div>
          {order.city || "—"}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Courier Status</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {order.courier_name || "Unassigned"}
            {order.dispatched_by_fynktech ? <FynkTechDispatchTag onDark /> : null}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Fulfillment Status</div>
          {order.fulfillment_status}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-brand-100">Tracking Number</div>
          <TrackingLink
            onDark
            courier={order.courier_name}
            tracking={order.tracking_number}
            fallback={order.courier_name === "Self Deliver" ? "Self Deliver" : "N/A"}
          />
        </div>
      </div>

      {editing ? (
        <>
          <datalist id={`${listId}-names`}>
            {hints.map((h) => (
              <option key={`n-${h.product_name}|${h.sku}`} value={h.product_name}>
                {h.sku}
              </option>
            ))}
          </datalist>
          <datalist id={`${listId}-skus`}>
            {hints
              .filter((h) => h.sku)
              .map((h) => (
                <option key={`s-${h.sku}|${h.product_name}`} value={h.sku}>
                  {h.product_name}
                </option>
              ))}
          </datalist>
        </>
      ) : null}

      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div
            key={item.id || item._key || index}
            className={`rounded-md border bg-white p-3 ${item._new ? "border-brand-200 bg-brand-50/30" : "border-surface-border"}`}
          >
            {editing ? (
              <div className="flex items-start gap-3">
                <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                  {ITEM_FIELDS.map(([field, label, type]) => (
                    <EditableField
                      key={field}
                      label={item._new && field === "product_name" ? "New product" : label}
                      type={type}
                      editing
                      value={item[field]}
                      onChange={(v) => onItemChange(index, field, v)}
                      list={
                        field === "product_name" ? `${listId}-names` : field === "barcode" ? `${listId}-skus` : undefined
                      }
                      placeholder={
                        item._new
                          ? { product_name: "Type a product name", barcode: "Optional", unit_price: "0.00" }[field]
                          : undefined
                      }
                      autoFocus={field === "product_name" && item._key === focusKey}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onItemRemove(index)}
                  disabled={items.length <= 1}
                  title={items.length <= 1 ? "An order needs at least one product" : "Remove this product"}
                  aria-label="Remove this product"
                  className="mt-5 shrink-0 rounded-md border border-red-200 p-2 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-surface-border disabled:text-slate-300 disabled:hover:bg-transparent"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 7l-.87 12.14A2 2 0 0116.14 21H7.86a2 2 0 01-1.99-1.86L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                {/* A long name is cut to one line; hover shows all of it. */}
                <div className="min-w-0 max-w-xs flex-1">
                  <div className="text-xs text-slate-400">Name</div>
                  <p className="truncate text-sm font-medium text-slate-900" title={item.product_name}>
                    {item.product_name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500" title={item.barcode || "No SKU"}>
                    SKU: {item.barcode ? <span className="font-medium text-slate-700">{item.barcode}</span> : <span className="text-amber-600">No SKU</span>}
                    {item.pack_units > 1 ? <span className="ml-2 text-slate-400">· {item.pack_units} units each</span> : null}
                  </p>
                </div>
                {/* Fixed column widths so Price/QTY/Total line up across
                    every item, whatever the numbers' lengths. */}
                <div className="grid shrink-0 grid-cols-[5.5rem_3rem_5.5rem] gap-x-4 text-sm text-slate-600">
                  <div>
                    <div className="text-xs text-slate-400">Price</div>
                    {item.unit_price}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">QTY</div>
                    {item.quantity}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Total</div>
                    {(item.quantity * item.unit_price - (item.discount_amount || 0)).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing ? (
        <button
          type="button"
          onClick={onItemAdd}
          className="mt-2 rounded-md border border-dashed border-surface-border px-3 py-1.5 text-xs font-medium text-brand-600 hover:border-brand-500 hover:bg-brand-50"
        >
          + Add another product
        </button>
      ) : null}
    </div>
  );
}
