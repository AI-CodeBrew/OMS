"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ordersService from "../../services/ordersService";

// The couriers' city list (super admin → Cities), loaded once per page load
// and shared by every CityInput. A failed load is retried on the next focus.
let cityNamesPromise = null;
function loadCityNames() {
  if (!cityNamesPromise) {
    cityNamesPromise = ordersService.getCityNames().catch((err) => {
      cityNamesPromise = null;
      throw err;
    });
  }
  return cityNamesPromise;
}

const MAX_SHOWN = 300;

function norm(s) {
  return String(s || "").toLowerCase().replace(/[.\s]+/g, " ").trim();
}

// A city text box with a dropdown of the city list: on focus it shows every
// city, and as you type it narrows to the matching ones (names starting with
// the text first, then names containing it). ↑/↓ + Enter pick, Esc closes.
// Typing a name that isn't on the list is still allowed - a small note says so.
export default function CityInput({ value, onChange, className = "", placeholder = "Start typing a city…", required, autoFocus }) {
  const [names, setNames] = useState([]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  function ensureLoaded() {
    loadCityNames()
      .then(setNames)
      .catch(() => setNames([]));
  }

  useEffect(ensureLoaded, []);

  const matches = useMemo(() => {
    const q = typed ? norm(value) : "";
    if (!q) return names;
    const starts = [];
    const contains = [];
    for (const name of names) {
      const n = norm(name);
      if (n.startsWith(q)) starts.push(name);
      else if (n.includes(q)) contains.push(name);
    }
    return starts.concat(contains);
  }, [names, value, typed]);

  const shown = matches.slice(0, MAX_SHOWN);
  const onList = !value || names.length === 0 || names.some((n) => norm(n) === norm(value));

  useEffect(() => {
    setActive(0);
  }, [value, typed]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function pick(name) {
    onChange(name);
    setTyped(false);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={value ?? ""}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onFocus={() => {
          if (!names.length) ensureLoaded();
          setTyped(false);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={className}
      />
      {open && shown.length > 0 ? (
        <ul
          ref={listRef}
          className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-md border border-surface-border bg-white py-1 text-sm shadow-lg"
        >
          {shown.map((name, i) => (
            <li
              key={name}
              // mousedown, not click: keeps the input from blurring first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(name);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-brand-50 text-brand-700" : "text-slate-700"}`}
            >
              {name}
            </li>
          ))}
          {matches.length > MAX_SHOWN ? (
            <li className="px-3 py-1.5 text-xs text-slate-400">Type more letters to see the rest…</li>
          ) : null}
        </ul>
      ) : null}
      {open && typed && value && shown.length === 0 && names.length > 0 ? (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-md border border-surface-border bg-white px-3 py-2 text-xs text-slate-500 shadow-lg">
          No city on the list matches "{value}".
        </div>
      ) : null}
      {!open && !onList ? (
        <p className="mt-0.5 text-xs text-amber-600">Not on the city list - the order may go to City Issue.</p>
      ) : null}
    </div>
  );
}
