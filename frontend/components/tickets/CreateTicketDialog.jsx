"use client";

import { useMemo, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import ticketsService from "../../services/ticketsService";
import { TICKET_CATEGORIES } from "../../constants/ticketCategories";
import { TICKET_PRIORITY_LABEL } from "./ticketStatus";

const PRIORITIES = Object.keys(TICKET_PRIORITY_LABEL);

// order is optional - omit it (or pass null) to raise a standalone ticket
// not attached to anything, from the /tickets page's "New ticket" button.
export default function CreateTicketDialog({ open, order, onClose, onCreated }) {
  const categories = Object.keys(TICKET_CATEGORIES);
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const subCategories = useMemo(() => TICKET_CATEGORIES[category] || [], [category]);

  function reset() {
    setCategory("");
    setSubCategory("");
    setDescription("");
    setPriority("medium");
    setError("");
  }

  function handleClose() {
    reset();
    onClose?.();
  }

  async function onSubmit() {
    if (!category || !description.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const ticket = await ticketsService.create({
        order: order?.id,
        category,
        sub_category: subCategory,
        description: description.trim(),
        priority,
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

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Category</span>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setSubCategory("");
          }}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
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
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
        >
          <option value="">Select a sub-category…</option>
          {subCategories.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Priority</span>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TICKET_PRIORITY_LABEL[p]}
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
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          disabled={!category || !description.trim()}
          loading={submitting}
          onClick={onSubmit}
        >
          Submit
        </Button>
      </div>
    </Modal>
  );
}
