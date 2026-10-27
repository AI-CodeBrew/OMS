"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import ticketsService from "../../services/ticketsService";
import ordersService from "../../services/ordersService";
import { TICKET_CATEGORIES } from "../../constants/ticketCategories";
import { DESCRIPTION_MIN_CHARS, descriptionLength } from "./ticketStatus";

const FIELD_CLASS =
  "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

function orderLabel(o) {
  return `OMS ${o.supabase_order_no ?? "—"} · ${o.order_number}${o.customer_name ? ` · ${o.customer_name}` : ""}`;
}

function searchOwnOrders(q) {
  return ordersService
    .list({ search: q, search_field: "all", page_size: 6 })
    .then((data) => data.results || []);
}

// Attach a ticket raised from the /tickets page to an order - search by
// order no., OMS id, customer or phone. search(q) -> orders; the store's
// own orders by default, one picked store's for the super admin.
function OrderPicker({ value, onChange, search = searchOwnOrders }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await search(q);
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
        <span className="truncate">{orderLabel(value)}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="shrink-0 text-xs font-medium text-brand-700 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search order no., OMS ID, customer or phone…"
        className={FIELD_CLASS}
      />
      {query.trim() ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-surface-border bg-white py-1 shadow-lg">
          {searching && !results.length ? (
            <li className="px-3 py-1.5 text-sm text-slate-400">Searching…</li>
          ) : !results.length ? (
            <li className="px-3 py-1.5 text-sm text-slate-400">No matching orders</li>
          ) : (
            results.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o);
                    setQuery("");
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-surface"
                >
                  {orderLabel(o)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

// order: the order this ticket is raised from (an order's Tickets tab, the
// orders page's Raise ticket). Without one - the /tickets page's "New
// ticket" - an order can still be picked here, or left out for a
// standalone ticket. Its type (By Customer / By Admin) isn't asked - the
// backend sets it from who's raising it.
//
// stores: the super admin's version - FynkTech raising a ticket *to* a
// store. A Store picker comes first (required), the order picker searches
// that store's orders (searchStoreOrders), and createTicket does the save.
export default function CreateTicketDialog({
  open,
  order,
  onClose,
  onCreated,
  stores = null,
  createTicket = (payload) => ticketsService.create(payload),
  searchStoreOrders = null,
}) {
  const categories = Object.keys(TICKET_CATEGORIES);
  const [storeId, setStoreId] = useState("");
  const [pickedOrder, setPickedOrder] = useState(null);
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const subCategories = useMemo(() => TICKET_CATEGORIES[category] || [], [category]);
  const descriptionChars = descriptionLength(description);
  const descriptionTooShort = descriptionChars < DESCRIPTION_MIN_CHARS;
  const ticketOrder = order || pickedOrder;
  const needsStore = Boolean(stores) && !storeId;
  const searchOrders = useMemo(
    () => (stores && searchStoreOrders ? (q) => searchStoreOrders(storeId, q) : searchOwnOrders),
    [stores, searchStoreOrders, storeId]
  );

  function reset() {
    setStoreId("");
    setPickedOrder(null);
    setCategory("");
    setSubCategory("");
    setDescription("");
    setError("");
  }

  function handleClose() {
    reset();
    onClose?.();
  }

  async function onSubmit() {
    if (!category || descriptionTooShort || needsStore || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const ticket = await createTicket({
        ...(stores ? { organization_id: storeId } : {}),
        order: ticketOrder?.id,
        category,
        sub_category: subCategory,
        description: description.trim(),
      });
      reset();
      onCreated?.(ticket);
    } catch (err) {
      setError(err.message || "Failed to raise ticket");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={order ? `Raise ticket — ${order.order_number}` : "Raise ticket"}
    >
      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {stores ? (
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Store</span>
          <select
            value={storeId}
            onChange={(e) => {
              setStoreId(e.target.value);
              setPickedOrder(null);
            }}
            className={FIELD_CLASS}
          >
            <option value="">Select a store…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!order && !needsStore ? (
        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium text-slate-700">Order (optional)</span>
          <OrderPicker key={storeId} value={pickedOrder} onChange={setPickedOrder} search={searchOrders} />
        </div>
      ) : null}

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Category</span>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setSubCategory("");
          }}
          className={FIELD_CLASS}
        >
          <option value="">Select a category…</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Sub-category</span>
        <select
          value={subCategory}
          onChange={(e) => setSubCategory(e.target.value)}
          disabled={!category}
          className={`${FIELD_CLASS} disabled:bg-slate-50`}
        >
          <option value="">Select a sub-category…</option>
          {subCategories.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className={FIELD_CLASS}
        />
        <span
          className={`mt-1 block text-xs ${
            description && descriptionTooShort ? "text-red-600" : "text-slate-400"
          }`}
        >
          {descriptionTooShort
            ? `At least ${DESCRIPTION_MIN_CHARS} characters (${descriptionChars}/${DESCRIPTION_MIN_CHARS})`
            : `${descriptionChars} characters`}
        </span>
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button disabled={!category || descriptionTooShort || needsStore} loading={submitting} onClick={onSubmit}>
          Submit
        </Button>
      </div>
    </Modal>
  );
}
