"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import ordersService from "../../services/ordersService";

// Fix Cities (user, 2026-11-23 - backend oms.city_fixer). Awaiting
// Confirmation's button corrects misspelt cities from the address: the sure
// ones are fixed straight away (City Fixed badge, status unchanged); the rest
// wait here under Need checking until a person picks the city. Fixed ones
// can be undone.
//
// request: null (closed) | {mode: "run" | "review", orderIds, filters}.
// onChanged: something changed - the page reloads its list.
// onShowInList(value): filter the orders list by City Fix ("check", ...).

const GROUPS = [
  {
    key: "likely",
    title: "Likely",
    hint: "One close match - check it and click Use.",
    tone: "border-amber-200 bg-amber-50/60",
  },
  {
    key: "unsure",
    title: "Not sure",
    hint: "More than one city could fit - pick the right one from the address.",
    tone: "border-orange-200 bg-orange-50/60",
  },
  {
    key: "not_found",
    title: "Not found",
    hint: "Nothing close on the city list - type the city.",
    tone: "border-red-200 bg-red-50/50",
  },
  {
    key: "no_courier",
    title: "No courier serves this city",
    hint: "A real city that no courier on the list covers - pick another city, or cancel the order from Actions.",
    tone: "border-slate-200 bg-slate-50",
  },
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The address with the words that matched a city marked.
function Highlighted({ text, phrases }) {
  const words = useMemo(
    () => [...new Set((phrases || []).flatMap((p) => p.split(/\s+/)).filter((w) => w.length > 1))],
    [phrases]
  );
  if (!text) return <span className="text-slate-400">No address</span>;
  if (!words.length) return <span>{text}</span>;
  const pattern = new RegExp(`\\b(${words.map(escapeRegExp).join("|")})\\b`, "gi");
  const parts = text.split(pattern);
  return (
    <span>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-slate-900">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

// Type-to-search over the couriers' city list; picking one fills the box.
function CityPicker({ cities, value, onChange, onUse, busy, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!term) return [];
    const starts = cities.filter((c) => c.toLowerCase().startsWith(term));
    const contains = cities.filter((c) => !c.toLowerCase().startsWith(term) && c.toLowerCase().includes(term));
    return [...starts, ...contains].slice(0, 8);
  }, [cities, term]);
  const exact = cities.find((c) => c.toLowerCase() === term);

  function pick(name) {
    onChange(name);
    setOpen(false);
  }

  return (
    <div className="flex items-start gap-2">
      <div className="relative w-56">
        <input
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && matches[active]) pick(matches[active]);
              else if (exact) onUse(exact);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Type the city…"
          className="w-full rounded-md border border-surface-border px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        {open && matches.length ? (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-md border border-surface-border bg-white py-1 shadow-lg">
            {matches.map((name, i) => {
              const at = name.toLowerCase().indexOf(term);
              return (
                <li key={name}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(name);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-sm ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
                  >
                    {at >= 0 ? (
                      <>
                        {name.slice(0, at)}
                        <strong>{name.slice(at, at + term.length)}</strong>
                        {name.slice(at + term.length)}
                      </>
                    ) : (
                      name
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <Button
        className="!px-3 !py-1.5"
        disabled={!exact}
        loading={busy}
        onClick={() => exact && onUse(exact)}
        title={exact ? `Use ${exact}` : "Pick a city from the list"}
      >
        Use
      </Button>
    </div>
  );
}

// The order's city and address, line by line, so the address can be read
// before picking a city (user, 2026-11-25). `cityRow` replaces the City
// line (Fixed shows before -> after there); the words that matched a city
// are marked. Rows from an older backend only have the joined `address`.
function AddressDetails({ row, phrases, cityRow }) {
  const line1 = row.address_line1 ?? row.address;
  const lines = [
    ["Address 1", line1, true],
    ["Address 2", row.address_line2, false],
    ["Postal code", row.postal_code, false],
  ].filter(([, value, always]) => always || (value || "").trim());
  return (
    <dl className="mt-1.5 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md border border-surface-border bg-slate-50 px-2.5 py-1.5 text-sm">
      <dt className="text-xs leading-5 text-slate-500">City</dt>
      <dd className="min-w-0">{cityRow}</dd>
      {lines.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-xs leading-5 text-slate-500">{label}</dt>
          <dd className="min-w-0 break-words text-slate-700">
            <Highlighted text={value} phrases={phrases} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OrderHead({ row }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-semibold text-slate-900">{row.order_number}</span>
      {row.store ? <span className="text-xs text-slate-400">{row.store}</span> : null}
      <span className="text-xs text-slate-500">{row.customer_name}</span>
    </div>
  );
}

function CheckRow({ row, cities, busy, onUse }) {
  const [picking, setPicking] = useState(row.group === "not_found");
  const [typed, setTyped] = useState("");
  const options = row.options || [];

  return (
    <li className="rounded-md border border-surface-border bg-white px-3 py-2.5">
      <OrderHead row={row} />
      <AddressDetails
        row={row}
        phrases={row.highlight}
        cityRow={<span className="font-medium text-red-700">{row.city ? `"${row.city}"` : "(blank)"}</span>}
      />
      {row.note ? <div className="mt-0.5 text-xs text-slate-500">{row.note}</div> : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {row.group === "likely" && row.suggestion ? (
          <>
            <span className="text-sm text-slate-600">→</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-sm font-medium text-emerald-800">
              {row.suggestion}
              {options[0]?.province ? <span className="ml-1 text-xs font-normal text-emerald-700/70">{options[0].province}</span> : null}
            </span>
            <Button className="!px-3 !py-1" loading={busy} onClick={() => onUse(row, row.suggestion)}>
              Use
            </Button>
          </>
        ) : null}
        {row.group === "unsure"
          ? options.map((o) => (
              <button
                key={o.name}
                type="button"
                disabled={busy}
                onClick={() => onUse(row, o.name)}
                title={o.why}
                className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50"
              >
                {o.name}
                {o.province ? <span className="ml-1 text-xs font-normal text-brand-700/70">{o.province}</span> : null}
              </button>
            ))
          : null}
        {row.group === "likely" && options.length > 1
          ? options.slice(1).map((o) => (
              <button
                key={o.name}
                type="button"
                disabled={busy}
                onClick={() => onUse(row, o.name)}
                title={o.why}
                className="rounded-md border border-surface-border px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {o.name}
              </button>
            ))
          : null}
        {!picking ? (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            {row.group === "likely" ? "Change" : row.group === "unsure" ? "Other city" : "Pick a city"}
          </button>
        ) : null}
      </div>
      {picking ? (
        <div className="mt-2">
          <CityPicker
            cities={cities}
            value={typed}
            onChange={setTyped}
            busy={busy}
            autoFocus={row.group !== "not_found"}
            onUse={(name) => onUse(row, name)}
          />
        </div>
      ) : null}
    </li>
  );
}

function FixedRow({ row, busy, onUndo }) {
  const auto = row.city_fix === "auto";
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-surface-border bg-white px-3 py-2.5">
      <div className="min-w-0">
        <OrderHead row={row} />
        <AddressDetails
          row={row}
          phrases={row.highlight || [(row.city || "").toLowerCase()]}
          cityRow={
            <span>
              <span className="text-slate-500 line-through">{row.city_before_fix || "(blank)"}</span>
              <span className="mx-1.5 text-slate-400">→</span>
              <span className="font-medium text-emerald-800">{row.city}</span>
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  auto ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
                }`}
              >
                {auto ? "Automatically" : "By hand"}
              </span>
            </span>
          }
        />
        {row.city_fix_note || row.note ? (
          <div className="mt-0.5 text-xs text-slate-400">{row.note || row.city_fix_note}</div>
        ) : null}
      </div>
      <Button variant="secondary" className="!px-3 !py-1" loading={busy} onClick={() => onUndo(row)}>
        Undo
      </Button>
    </li>
  );
}

export default function FixCitiesModal({ request, onClose, onChanged, onShowInList }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [check, setCheck] = useState([]);
  const [fixed, setFixed] = useState([]);
  const [tab, setTab] = useState("check");
  const [cities, setCities] = useState([]);
  const [busy, setBusy] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const changed = useRef(false);

  useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;
    changed.current = false;
    setLoading(true);
    setError("");
    setSummary(null);
    setCheck([]);
    setFixed([]);
    (async () => {
      try {
        if (request.mode === "run") {
          const data = await ordersService.fixCities({ orderIds: request.orderIds, filters: request.filters });
          if (cancelled) return;
          setSummary(data.summary);
          setCheck(data.check || []);
          setFixed(data.fixed || []);
          setTab((data.check || []).length || !(data.fixed || []).length ? "check" : "fixed");
          if (data.summary?.fixed) changed.current = true;
        } else {
          const data = await ordersService.fixCitiesReview(request.filters);
          if (cancelled) return;
          setCheck(data.check || []);
          setFixed(data.fixed || []);
          setTab((data.check || []).length || !(data.fixed || []).length ? "check" : "fixed");
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Fix Cities failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    if (!cities.length) {
      ordersService
        .getCityNames()
        .then((names) => !cancelled && setCities(names))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function setRowBusy(id, on) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function applyCity(fixes) {
    setError("");
    fixes.forEach((f) => setRowBusy(f.order_id, true));
    try {
      const data = await ordersService.fixCity(fixes);
      const done = (data.results || []).filter((r) => r.success);
      const failed = (data.results || []).filter((r) => !r.success);
      if (done.length) {
        changed.current = true;
        const ids = new Set(done.map((r) => r.order_id));
        setCheck((rows) => rows.filter((r) => !ids.has(r.order_id)));
        setFixed((rows) => [...done.map((r) => r.order).filter(Boolean), ...rows.filter((r) => !ids.has(r.order_id))]);
      }
      if (failed.length) {
        setError(failed.map((r) => `${r.order_number || ""} ${r.error}`.trim()).join("; "));
      }
    } catch (err) {
      setError(err.message || "Could not fix the city");
    } finally {
      fixes.forEach((f) => setRowBusy(f.order_id, false));
    }
  }

  async function undo(row) {
    setError("");
    setRowBusy(row.order_id, true);
    try {
      const data = await ordersService.undoCityFix(row.order_id);
      changed.current = true;
      setFixed((rows) => rows.filter((r) => r.order_id !== row.order_id));
      if (data.order) setCheck((rows) => [data.order, ...rows.filter((r) => r.order_id !== row.order_id)]);
    } catch (err) {
      setError(err.message || "Could not undo");
    } finally {
      setRowBusy(row.order_id, false);
    }
  }

  async function useAllSuggested() {
    const fixes = check
      .filter((r) => r.group === "likely" && r.suggestion)
      .map((r) => ({ order_id: r.order_id, city: r.suggestion }));
    if (!fixes.length) return;
    if (!window.confirm(`Use the suggested city on ${fixes.length} order${fixes.length === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    try {
      await applyCity(fixes);
    } finally {
      setBulkBusy(false);
    }
  }

  function close() {
    if (changed.current) onChanged?.();
    onClose();
  }

  const byGroup = useMemo(() => {
    const groups = {};
    check.forEach((r) => {
      (groups[r.group] = groups[r.group] || []).push(r);
    });
    return groups;
  }, [check]);
  const likelyCount = (byGroup.likely || []).filter((r) => r.suggestion).length;

  return (
    <Modal
      open={Boolean(request)}
      onClose={close}
      title="Fix Cities"
      width="max-w-4xl"
      footer={
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {request?.mode === "run" ? "Checking cities against the addresses…" : "Loading…"}
        </p>
      ) : (
        <div className="space-y-3">
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          {summary ? (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Checked {summary.checked} order{summary.checked === 1 ? "" : "s"}:{" "}
              <strong>{summary.fixed} fixed automatically</strong>, {summary.need_check} need checking
              {summary.already_ok ? `, ${summary.already_ok} already fine` : ""}.
              {summary.too_many ? ` ${summary.too_many} more were left for the next click.` : ""}
              {summary.fixed ? " Fixed orders keep their status - approve them as usual." : ""}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-b border-surface-border">
            <div className="flex gap-4">
              {[
                ["check", `Need checking (${check.length})`],
                ["fixed", `Fixed (${fixed.length})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${
                    tab === key ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {onShowInList && (tab === "check" ? check.length : fixed.length) ? (
              <button
                type="button"
                onClick={() => {
                  onShowInList(tab === "check" ? ["check"] : ["auto", "manual"]);
                  close();
                }}
                className="pb-2 text-xs font-medium text-brand-700 hover:underline"
              >
                Show these in the orders list
              </button>
            ) : null}
          </div>

          {tab === "check" ? (
            check.length ? (
              GROUPS.filter((g) => byGroup[g.key]?.length).map((g) => (
                <section key={g.key} className={`rounded-lg border p-3 ${g.tone}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {g.title} ({byGroup[g.key].length})
                      </h3>
                      <p className="text-xs text-slate-500">{g.hint}</p>
                    </div>
                    {g.key === "likely" && likelyCount > 1 ? (
                      <Button className="!px-3 !py-1.5" loading={bulkBusy} onClick={useAllSuggested}>
                        Use all suggested ({likelyCount})
                      </Button>
                    ) : null}
                  </div>
                  <ul className="space-y-2">
                    {byGroup[g.key].map((row) => (
                      <CheckRow
                        key={row.order_id}
                        row={row}
                        cities={cities}
                        busy={busy.has(row.order_id)}
                        onUse={(r, city) => applyCity([{ order_id: r.order_id, city }])}
                      />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                {summary ? "Nothing needs checking." : "No order is waiting for a city check."}
              </p>
            )
          ) : fixed.length ? (
            <ul className="space-y-2">
              {fixed.map((row) => (
                <FixedRow key={row.order_id} row={row} busy={busy.has(row.order_id)} onUndo={undo} />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">No fixed cities in this card.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
