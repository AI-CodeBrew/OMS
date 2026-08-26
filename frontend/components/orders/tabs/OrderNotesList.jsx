"use client";

import { useEffect, useState } from "react";
import Button from "../../shared/Button";
import ordersService from "../../../services/ordersService";

export default function OrderNotesList({ orderId, kind, placeholder }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await ordersService.listNotes(orderId, kind);
      setNotes(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, kind]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    try {
      await ordersService.createNote(orderId, { kind, body: body.trim() });
      setBody("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="mb-3 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <Button type="submit" disabled={submitting}>
          Add
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing here yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-surface-border bg-white px-3 py-2 text-sm">
              <p className="text-slate-800">{n.body}</p>
              <p className="mt-1 text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
