"use client";

import { useCallback, useEffect, useState } from "react";
import wmsService from "../../services/wmsService";
import Modal from "../shared/Modal";
import Button from "../shared/Button";

// Rows per request - keeps each call well inside a request timeout at
// Shopify's ~2 requests/second (up to three calls per row).
const BATCH_SIZE = 10;

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function ChangeLine({ line }) {
  if (line.type === "title") {
    return (
      <li className="text-sm text-slate-600">
        <span className="font-medium text-slate-700">{line.label}:</span>{" "}
        <span className="text-slate-500 line-through">{line.from || "(no name)"}</span>{" "}
        → <span className="font-medium text-slate-900">{line.to}</span>
      </li>
    );
  }
  const tone = line.delta > 0 ? "text-green-700" : "text-red-600";
  return (
    <li className="text-sm text-slate-600">
      <span className="font-medium text-slate-700">{line.label}:</span>{" "}
      <span className={`font-semibold tabular-nums ${tone}`}>{signed(line.delta)}</span>
      {line.from !== null && line.from !== undefined ? (
        <>
          {" "}
          · Shopify <span className="tabular-nums">{line.from}</span> →{" "}
          <span className="font-medium tabular-nums text-slate-900">{line.to}</span>
        </>
      ) : null}
    </li>
  );
}

/**
 * Push to Shopify: lists every pending rename / stock adjustment, and only
 * on "Confirm & Push" sends exactly those (each row's `expected` values),
 * so the server can refuse if anything changed after this summary loaded.
 */
export default function ShopifyPushModal({ open, onClose, onPushed }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSummary(await wmsService.shopifyPendingChanges());
    } catch (err) {
      setSummary(null);
      setError(err.message || "Failed to load pending changes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setProgress({ done: 0, total: 0 });
    loadSummary();
  }, [open, loadSummary]);

  if (!open) return null;

  const changes = summary?.changes || [];
  const pushable = changes.filter((c) => !c.in_progress);

  async function onConfirm() {
    if (pushing || pushable.length === 0) return;
    setPushing(true);
    setError("");
    setResult(null);
    const payload = pushable.map((c) => ({ id: c.id, ...c.expected }));
    setProgress({ done: 0, total: payload.length });
    const results = [];
    let stopError = "";
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      try {
        const data = await wmsService.pushChangesToShopify(payload.slice(i, i + BATCH_SIZE));
        results.push(...(data.results || []));
      } catch (err) {
        // A conflict (edited meanwhile / already being pushed) or a
        // connection error - stop here; the rest stay pending for a retry.
        stopError = err.message || "Push failed";
        break;
      }
      setProgress({ done: Math.min(i + BATCH_SIZE, payload.length), total: payload.length });
    }
    const failed = results.filter((r) => !r.success);
    setResult({
      pushed: results.length - failed.length,
      failed,
      notSent: payload.length - results.length,
    });
    if (stopError) setError(stopError);
    setPushing(false);
    await onPushed?.();
    await loadSummary();
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={pushing}>
        {result ? "Close" : "Cancel"}
      </Button>
      <Button onClick={onConfirm} loading={pushing} disabled={loading || pushable.length === 0}>
        {result && pushable.length > 0 ? "Retry remaining" : "Confirm & Push"}
      </Button>
    </>
  );

  return (
    <Modal
      open
      title="Push changes to Shopify"
      onClose={pushing ? undefined : onClose}
      footer={footer}
      width="max-w-2xl"
    >
      {pushing ? (
        <p className="mb-3 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Pushing to Shopify… {progress.done} of {progress.total} products sent. Keep this window open.
        </p>
      ) : null}

      {result ? (
        <div
          className={`mb-3 rounded-md px-3 py-2 text-sm ${
            result.failed.length || result.notSent ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-700"
          }`}
        >
          <p>
            {result.pushed} product{result.pushed === 1 ? "" : "s"} updated on Shopify.
            {result.failed.length ? ` ${result.failed.length} failed and are kept for retry.` : ""}
            {result.notSent ? ` ${result.notSent} not sent.` : ""}
          </p>
          {result.failed.length ? (
            <ul className="mt-1 list-disc pl-5">
              {result.failed.map((r) => (
                <li key={r.id}>
                  <strong>{r.product_name || r.sku}</strong>: {r.errors.join("; ")}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {loading && !summary ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading pending changes…</p>
      ) : summary && changes.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          No pending changes — everything adjusted here is already on Shopify.
        </p>
      ) : summary ? (
        <>
          {!result ? (
            <p className="mb-3 text-sm text-slate-500">
              These changes will be sent to your connected Shopify store. Stock is applied as an
              adjustment (+/−) to Shopify&apos;s current count, so orders Shopify has taken meanwhile
              aren&apos;t overwritten.
            </p>
          ) : null}
          {!summary.live ? (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Couldn&apos;t read Shopify&apos;s current stock counts, so before/after on Shopify isn&apos;t
              shown. The adjustments will still apply. {summary.live_error}
            </p>
          ) : null}
          <ul className="divide-y divide-surface-border rounded-lg border border-surface-border">
            {changes.map((c) => (
              <li key={c.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{c.product_name || "—"}</p>
                  <p className="text-xs text-slate-500">
                    {c.sku ? `SKU ${c.sku} · ` : ""}WMS on hand {c.wms_quantity}
                  </p>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {c.changes.map((line) => (
                    <ChangeLine key={line.type} line={line} />
                  ))}
                </ul>
                {c.in_progress ? (
                  <p className="mt-1 text-xs text-brand-700">Already being pushed — skipped.</p>
                ) : c.last_error ? (
                  <p className="mt-1 text-xs text-red-600">Last attempt failed: {c.last_error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Modal>
  );
}
