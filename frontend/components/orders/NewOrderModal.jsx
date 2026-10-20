"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";

const ImportNewOrdersModal = dynamic(() => import("./ImportNewOrdersModal"), { ssr: false });

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_ITEM = { product_name: "", barcode: "", quantity: 1, unit_price: "", weight_grams: "" };

const emptyForm = () => ({
  order_number: "",
  order_date: today(),
  payment_gateway: "cod",
  customer_name: "",
  customer_phone: "",
  secondary_phone: "",
  customer_email: "",
  address_line1: "",
  // Not on the form - carried over when recreating an order that has them.
  address_line2: "",
  postal_code: "",
  city: "",
  shipping_amount: "0",
  discount: "0",
  notes: "",
  items: [{ ...EMPTY_ITEM }],
});

// "Recreate order": the same customer and products as `order`, as a new
// order (today's date, its own number) - everything stays editable.
const formFromOrder = (order) => ({
  ...emptyForm(),
  payment_gateway: order.payment_gateway || "cod",
  customer_name: order.customer_name || "",
  customer_phone: order.customer_phone || "",
  secondary_phone: order.secondary_phone || "",
  customer_email: order.customer_email || "",
  address_line1: order.address_line1 || "",
  address_line2: order.address_line2 || "",
  postal_code: order.postal_code || "",
  city: order.city || "",
  shipping_amount: String(order.shipping_amount ?? "0"),
  notes: `Recreated from order ${order.order_number}`,
  items: (order.items || []).length
    ? order.items.map((item) => ({
        product_name: item.product_name || "",
        barcode: item.barcode || "",
        quantity: item.quantity || 1,
        unit_price: String(item.unit_price ?? ""),
        weight_grams: item.weight_grams ? String(item.weight_grams) : "",
      }))
    : [{ ...EMPTY_ITEM }],
});

const INPUT =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none hover:border-slate-400 focus:border-brand-500";

// Products table: name | SKU | qty | unit price | weight | amount | remove.
const ITEM_GRID =
  "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_4.5rem_minmax(0,1fr)_minmax(0,1fr)_5.5rem_1.25rem] gap-2";
const CELL_INPUT =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none hover:border-slate-400 focus:border-brand-500";

const Req = () => <span className="text-red-600"> *</span>;

function Field({ label, required = false, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : <span className="text-slate-400"> (optional)</span>}
      </span>
      {children}
    </label>
  );
}

function MethodCard({ title, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border border-surface-border bg-white text-slate-700 shadow-sm transition hover:border-brand-500 hover:text-brand-700 hover:shadow"
    >
      {icon}
      <span className="text-lg font-medium">{title}</span>
    </button>
  );
}

const PlusIcon = (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v8M8 12h8" strokeLinecap="round" />
  </svg>
);

const DownloadIcon = (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M20 16.5A4.5 4.5 0 0 0 17.5 8h-1.3A7 7 0 1 0 4 14.9" strokeLinecap="round" />
    <path d="M12 12v9M8.5 17.5 12 21l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const UploadIcon = (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M20 16.5A4.5 4.5 0 0 0 17.5 8h-1.3A7 7 0 1 0 4 14.9" strokeLinecap="round" />
    <path d="M12 21v-9M8.5 15.5 12 12l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * "Manual Order": pick a booking method first - fill in one order by hand,
 * download the OMS sample sheet, or upload a filled sheet (which opens in
 * the same editable grid as the courier-sheet import before anything is
 * created).
 */
export default function NewOrderModal({ open, recreateFrom = null, onClose, onCreated }) {
  const [view, setView] = useState("methods"); // "methods" | "manual"
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [csvFile, setCsvFile] = useState(null);
  const [importFile, setImportFile] = useState(null); // handed to ImportNewOrdersModal
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [onShopify, setOnShopify] = useState(false);
  const fileRef = useRef(null);

  // Shopify numbers an order created there; otherwise the form starts with
  // the number after the store's newest order (still editable).
  async function openManual() {
    setView("manual");
    try {
      const info = await ordersService.getNewOrderInfo();
      setShopifyConnected(Boolean(info.shopify_connected));
      setOnShopify(Boolean(info.shopify_connected));
      setForm((f) => (f.order_number ? f : { ...f, order_number: info.next_order_number || "" }));
    } catch {
      // Leaves the number blank - the server fills one in on create.
    }
  }

  // Straight to the filled-in form. The full order is fetched because a
  // list row may not carry every field the form copies.
  useEffect(() => {
    if (!open || !recreateFrom) return;
    let cancelled = false;
    setForm(formFromOrder(recreateFrom));
    openManual();
    ordersService
      .get(recreateFrom.id)
      .then((order) => {
        if (!cancelled) setForm((f) => ({ ...formFromOrder(order), order_number: f.order_number }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recreateFrom]);

  function resetAll() {
    setView("methods");
    setOnShopify(false);
    setForm(emptyForm());
    setError("");
    setCsvFile(null);
    setImportFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    resetAll();
    onClose?.();
  }

  function updateField(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function updateItem(index, field) {
    return (e) =>
      setForm((f) => ({
        ...f,
        items: f.items.map((item, i) => (i === index ? { ...item, [field]: e.target.value } : item)),
      }));
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  }

  function removeItem(index) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  }

  const itemsTotal = form.items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  );
  const discount = Number(form.discount) || 0;
  const grandTotal = itemsTotal + (Number(form.shipping_amount) || 0) - discount;

  async function onSubmit(e) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      await ordersService.create({
        create_on_shopify: onShopify,
        order_number: onShopify ? "" : form.order_number.trim(),
        order_date: form.order_date,
        payment_gateway: form.payment_gateway,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        secondary_phone: form.secondary_phone.trim(),
        customer_email: form.customer_email.trim(),
        address_line1: form.address_line1.trim(),
        address_line2: form.address_line2.trim(),
        postal_code: form.postal_code.trim(),
        city: form.city.trim(),
        shipping_amount: form.shipping_amount || 0,
        discount: form.discount || 0,
        notes: form.notes.trim(),
        items: form.items.map((item) => ({
          product_name: item.product_name.trim(),
          barcode: item.barcode.trim(),
          quantity: Number(item.quantity) || 1,
          unit_price: item.unit_price || 0,
          weight_grams: item.weight_grams === "" ? null : Number(item.weight_grams),
        })),
      });
      onCreated?.();
      close();
    } catch (err) {
      setError(err.message || "Failed to create order");
    } finally {
      setCreating(false);
    }
  }

  async function downloadSample() {
    setError("");
    try {
      await ordersService.downloadImportTemplate();
    } catch (err) {
      setError(err.message || "Could not download the sample file");
    }
  }

  function onPickCsv(e) {
    const picked = e.target.files?.[0] || null;
    setError("");
    if (picked && !/\.csv$/i.test(picked.name)) {
      setError("Only CSV files can be uploaded.");
      setCsvFile(null);
      e.target.value = "";
      return;
    }
    setCsvFile(picked);
  }

  if (!open) return null;

  // The sheet flow lives in ImportNewOrdersModal (editable grid -> preview
  // -> create); this modal steps aside while it's open.
  if (importFile) {
    return (
      <ImportNewOrdersModal
        open
        initialFile={importFile}
        onClose={close}
        onImported={() => onCreated?.()}
      />
    );
  }

  const errorBox = error ? (
    <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  ) : null;

  if (view === "methods") {
    return (
      <Modal open={open} onClose={close} title="Manual order" width="max-w-3xl">
        {errorBox}
        <h3 className="mb-5 text-center text-2xl font-normal text-slate-700">Booking Methods</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MethodCard title="Book Manual" icon={PlusIcon} onClick={openManual} />
          <MethodCard title="Download Sample File" icon={DownloadIcon} onClick={downloadSample} />
        </div>

        <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-surface-border px-4 py-6 text-slate-600">
          {UploadIcon}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPickCsv}
            className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-900"
          />
          <p className="text-xs text-slate-500">
            Note: only CSV files can be uploaded. Use the sample file for the exact columns.
          </p>
          <Button disabled={!csvFile} onClick={() => setImportFile(csvFile)}>
            Next
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={recreateFrom ? `Recreate order ${recreateFrom.order_number}` : "Book manual order"}
      width="max-w-3xl"
    >
      {errorBox}
      <form onSubmit={onSubmit} className="space-y-5">
        {shopifyConnected ? (
          <label className="flex items-start gap-2 rounded-md border border-surface-border bg-surface px-3 py-2.5">
            <input
              type="checkbox"
              checked={onShopify}
              onChange={(e) => setOnShopify(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">Also create on Shopify</span>
              <span className="block text-xs text-slate-500">
                Creates the order on your store, which gives it the next order number. Products whose
                SKU is on Shopify are taken from its stock there.
              </span>
            </span>
          </label>
        ) : null}

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Order</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Order number" required={!onShopify}>
              {onShopify ? (
                <input disabled value="Assigned by Shopify" className={`${INPUT} bg-surface text-slate-500`} />
              ) : (
                <input required value={form.order_number} onChange={updateField("order_number")} className={INPUT} />
              )}
            </Field>
            <Field label="Order date" required>
              <input
                required
                type="date"
                value={form.order_date}
                onChange={updateField("order_date")}
                className={INPUT}
              />
            </Field>
            <Field label="Payment method" required>
              <select required value={form.payment_gateway} onChange={updateField("payment_gateway")} className={INPUT}>
                <option value="cod">Cash on delivery (COD)</option>
                <option value="cc">Prepaid</option>
              </select>
            </Field>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer name" required>
              <input required value={form.customer_name} onChange={updateField("customer_name")} className={INPUT} />
            </Field>
            <Field label="Phone" required>
              <input
                required
                inputMode="tel"
                placeholder="03001234567"
                pattern="(\+92|0092|92|0)?3[0-9]{9}"
                title="Pakistani mobile number, e.g. 03001234567"
                value={form.customer_phone}
                onChange={updateField("customer_phone")}
                className={INPUT}
              />
            </Field>
            <Field label="Secondary phone">
              <input
                inputMode="tel"
                value={form.secondary_phone}
                onChange={updateField("secondary_phone")}
                className={INPUT}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.customer_email}
                onChange={updateField("customer_email")}
                className={INPUT}
              />
            </Field>
            <Field label="Address" required className="sm:col-span-2">
              <input required value={form.address_line1} onChange={updateField("address_line1")} className={INPUT} />
            </Field>
            <Field label="City" required>
              <input required value={form.city} onChange={updateField("city")} className={INPUT} />
            </Field>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Products</h4>
          {/* One header row + one aligned line per product, table-style.
              Scrolls sideways on narrow screens rather than wrapping. */}
          <div className="overflow-x-auto rounded-md border border-surface-border">
            <div className="min-w-[640px]">
              <div
                className={`${ITEM_GRID} border-b border-surface-border bg-surface px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500`}
              >
                <span>
                  Product name<Req />
                </span>
                <span>SKU</span>
                <span>
                  Qty<Req />
                </span>
                <span>
                  Unit price<Req />
                </span>
                <span>
                  Weight (g)<Req />
                </span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {form.items.map((item, index) => (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  className={`${ITEM_GRID} items-center border-b border-surface-border px-3 py-2 last:border-0`}
                >
                  <input
                    required
                    aria-label="Product name"
                    placeholder="e.g. Black T-Shirt"
                    value={item.product_name}
                    onChange={updateItem(index, "product_name")}
                    className={CELL_INPUT}
                  />
                  <input
                    aria-label="SKU"
                    placeholder="Optional"
                    value={item.barcode}
                    onChange={updateItem(index, "barcode")}
                    className={CELL_INPUT}
                  />
                  <input
                    required
                    aria-label="Quantity"
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={updateItem(index, "quantity")}
                    className={CELL_INPUT}
                  />
                  <input
                    required
                    aria-label="Unit price"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={item.unit_price}
                    onChange={updateItem(index, "unit_price")}
                    className={CELL_INPUT}
                  />
                  <input
                    required
                    aria-label="Weight in grams"
                    type="number"
                    min="1"
                    placeholder="grams"
                    value={item.weight_grams}
                    onChange={updateItem(index, "weight_grams")}
                    className={CELL_INPUT}
                  />
                  <span className="text-right text-sm tabular-nums text-slate-700">
                    {((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toFixed(2)}
                  </span>
                  {form.items.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      title="Remove this product"
                      aria-label="Remove this product"
                      className="text-slate-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={addItem}
            className="mt-2 rounded-md border border-dashed border-surface-border px-3 py-1.5 text-xs font-medium text-brand-600 hover:border-brand-500 hover:bg-brand-50"
          >
            + Add another product
          </button>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Shipping charges" required>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              value={form.shipping_amount}
              onChange={updateField("shipping_amount")}
              className={INPUT}
            />
          </Field>
          <Field label="Discount">
            <input
              type="number"
              step="0.01"
              min="0"
              max={itemsTotal || undefined}
              value={form.discount}
              onChange={updateField("discount")}
              className={INPUT}
            />
          </Field>
          <Field label="Notes">
            <input value={form.notes} onChange={updateField("notes")} className={INPUT} />
          </Field>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border pt-4">
          <div className="text-sm text-slate-600">
            Items {itemsTotal.toFixed(2)} + shipping {(Number(form.shipping_amount) || 0).toFixed(2)}
            {discount ? ` − discount ${discount.toFixed(2)}` : ""} ={" "}
            <span className="font-semibold text-slate-900">{grandTotal.toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={recreateFrom ? close : () => setView("methods")}>
              {recreateFrom ? "Cancel" : "Back"}
            </Button>
            <Button type="submit" loading={creating}>
              {onShopify ? "Create order & push to Shopify" : "Create order"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
