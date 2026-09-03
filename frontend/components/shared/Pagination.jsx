"use client";

import { useState } from "react";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const withGaps = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) withGaps.push("…");
    withGaps.push(p);
  });
  return withGaps;
}

// maxPageSize must match the backend's own PageNumberPagination.max_page_size
// for whichever endpoint this table reads from (OrderPagination=1000,
// WmsPagination=500, ...) - "All" requests min(count, maxPageSize) rather
// than the true row count, so a big unfiltered list doesn't try to pull
// and render thousands of rows in one go. Getting this wrong doesn't
// break anything - the API just clamps a too-high request - but the
// "Showing X to Y of Z" label would then quietly overstate what's really
// on screen, so keep it in sync with the real backend cap.
export default function Pagination({
  page,
  pageSize,
  count,
  onPageChange,
  onPageSizeChange,
  maxPageSize = 1000,
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);

  function go(p) {
    if (p >= 1 && p <= totalPages) onPageChange(p);
  }

  const allSize = Math.max(1, Math.min(count, maxPageSize));

  function onSelectChange(e) {
    if (e.target.value === "custom") {
      setCustomValue(String(pageSize));
      setCustomMode(true);
      return;
    }
    if (e.target.value === "all") {
      onPageSizeChange(allSize);
      return;
    }
    onPageSizeChange(Number(e.target.value));
  }

  function applyCustom() {
    const n = Math.floor(Number(customValue));
    if (n > 0) {
      onPageSizeChange(n);
      setCustomMode(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-slate-500">
      <div className="flex items-center gap-3">
        <span>
          Showing {from} to {to} of {count} orders
        </span>

        {customMode ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              autoFocus
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCustom()}
              placeholder="Rows"
              className="w-20 rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500"
            />
            <button
              type="button"
              onClick={applyCustom}
              className="rounded-md bg-brand-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-900"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setCustomMode(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
              aria-label="Cancel custom page size"
            >
              ✕
            </button>
          </div>
        ) : (
          <select
            value={
              PAGE_SIZE_OPTIONS.includes(pageSize)
                ? pageSize
                : pageSize === allSize && count > 100
                  ? "all"
                  : "custom"
            }
            onChange={onSelectChange}
            className="rounded-md border border-surface-border px-2 py-1 text-sm outline-none focus:border-brand-500"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
            {!PAGE_SIZE_OPTIONS.includes(pageSize) && !(pageSize === allSize && count > 100) ? (
              <option value={pageSize}>{pageSize} per page</option>
            ) : null}
            <option value="all">All ({allSize < count ? `first ${allSize}` : count})</option>
            <option value="custom">Custom…</option>
          </select>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(1)}
          disabled={page === 1}
          className="rounded-md border border-surface-border px-2 py-1 disabled:opacity-40"
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page === 1}
          className="rounded-md border border-surface-border px-2 py-1 disabled:opacity-40"
          aria-label="Previous page"
        >
          ‹
        </button>
        {buildPageList(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-2 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              className={`min-w-[2rem] rounded-md border px-2 py-1 ${
                p === page
                  ? "border-brand-800 bg-brand-800 text-white"
                  : "border-surface-border text-slate-600 hover:bg-surface"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page === totalPages}
          className="rounded-md border border-surface-border px-2 py-1 disabled:opacity-40"
          aria-label="Next page"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => go(totalPages)}
          disabled={page === totalPages}
          className="rounded-md border border-surface-border px-2 py-1 disabled:opacity-40"
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </div>
  );
}
