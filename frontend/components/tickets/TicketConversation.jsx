"use client";

import { useEffect, useState } from "react";
import Button from "../shared/Button";
import { timeAgo } from "../../lib/timeAgo";

const DEFAULT_LABELS = { tenant: "You", super_admin: "Support" };

// A ticket's history as a chat - the viewer's own messages on the right,
// the other side's on the left, each with a role label (no names) and its
// time. author_role is stored on each message at write time ("tenant" |
// "super_admin"), not derived - so this never needs a second lookup
// against who the viewer is. currentRole picks which side is "mine"; labels lets the
// admin page invert the wording ("Customer" / "You") without a new prop
// shape. allowInternal turns on the internal-note checkbox for admins -
// tenants never see this prop set, and the backend hides internal
// messages from the tenant-facing endpoint regardless.
export default function TicketConversation({
  ticketId,
  currentRole,
  listMessages,
  createMessage,
  labels = DEFAULT_LABELS,
  allowInternal = false,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await listMessages(ticketId);
      setMessages(Array.isArray(data) ? data : data.messages || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await createMessage(ticketId, body.trim(), isInternal);
      setBody("");
      setIsInternal(false);
      await load();
    } catch (err) {
      setError(err.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">No replies yet.</p>
      ) : (
        <ul className="mb-3 max-h-96 space-y-3 overflow-y-auto rounded-lg bg-slate-100/70 p-3">
          {messages.map((m) => {
            const mine = m.author_role === currentRole;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] px-3.5 py-2 text-sm shadow-sm ${
                    m.is_internal
                      ? "rounded-2xl border border-amber-200 bg-amber-50 text-amber-900"
                      : mine
                        ? "rounded-2xl rounded-br-sm bg-brand-700 text-white"
                        : "rounded-2xl rounded-bl-sm bg-white text-slate-800"
                  }`}
                >
                  <p
                    className={`mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold ${
                      m.is_internal ? "text-amber-700" : mine ? "text-white/80" : "text-brand-700"
                    }`}
                  >
                    {labels[m.author_role] || m.author_role}
                    {m.is_internal ? (
                      <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Internal
                      </span>
                    ) : null}
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p
                    className={`mt-1 text-right text-[10px] ${
                      m.is_internal ? "text-amber-600" : mine ? "text-white/70" : "text-slate-400"
                    }`}
                    title={timeAgo(m.created_at)}
                  >
                    {new Date(m.created_at).toLocaleString([], {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}

      <form onSubmit={onSubmit} className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isInternal ? "Add an internal note…" : "Type a reply…"}
          rows={2}
          className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${
            isInternal
              ? "border-amber-300 bg-amber-50/40 focus:border-amber-500 focus:ring-amber-100"
              : "border-surface-border focus:border-brand-500 focus:ring-brand-100"
          }`}
        />
        <div className="flex items-center justify-between gap-2">
          {allowInternal ? (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-surface-border text-amber-600 focus:ring-amber-400"
              />
              Internal note (not visible to customer)
            </label>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={sending || !body.trim()} loading={sending}>
            {isInternal ? "Add note" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
