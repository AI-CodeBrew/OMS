"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "./Button";

// The app's one search box (user, 2026-11-23: "anywhere we search, it should
// show suggestions - type piano and see every name with piano in that tab").
//
// - Searches by itself once typing pauses (onSearch, debounced); Enter, the
//   Search button or a picked suggestion search straight away; emptying the
//   box brings the full list back at once.
// - While typing, a dropdown lists what in this tab contains the text:
//   `suggestions` (strings the page already has - its rows' names, numbers…)
//   and/or `getSuggestions(term)` (a server lookup). Matching ignores case.
//
// value/onChange: the text in the box (the page keeps it). onSearch(term):
// apply `term` (already trimmed). Pages whose list filters on every
// keystroke anyway pass only onChange - the dropdown still helps there.
const MAX_SHOWN = 8;

function contains(text, term) {
  return String(text || "").toLowerCase().includes(term.toLowerCase());
}

function Highlighted({ text, term }) {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-brand-800">{text.slice(at, at + term.length)}</span>
      {text.slice(at + term.length)}
    </>
  );
}

export default function SearchBox({
  value,
  onChange,
  onSearch,
  suggestions = [],
  getSuggestions,
  placeholder = "Search",
  title,
  button = true,
  debounceMs = 400,
  className = "",
  inputClassName = "w-full sm:w-64",
  autoFocus = false,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [fetched, setFetched] = useState([]);
  const searchTimer = useRef(null);
  const fetchTimer = useRef(null);
  // The latest lookup - a page may pass a new function every render, which
  // mustn't refetch for the same text.
  const lookup = useRef(getSuggestions);
  lookup.current = getSuggestions;
  const hasLookup = Boolean(getSuggestions);
  const term = (value || "").trim();

  // The server's suggestions for the current text (if the page has a lookup).
  useEffect(() => {
    if (!hasLookup) return undefined;
    clearTimeout(fetchTimer.current);
    if (!term) {
      setFetched([]);
      return undefined;
    }
    let cancelled = false;
    fetchTimer.current = setTimeout(async () => {
      try {
        const results = await lookup.current(term);
        if (!cancelled) setFetched(Array.isArray(results) ? results : []);
      } catch {
        if (!cancelled) setFetched([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(fetchTimer.current);
    };
  }, [term, hasLookup]);

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const shown = useMemo(() => {
    if (!term) return [];
    const seen = new Set();
    const out = [];
    for (const raw of [...fetched, ...suggestions]) {
      const text = String(raw ?? "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key) || !contains(text, term)) continue;
      // Already exactly what's typed - nothing to suggest.
      if (key === term.toLowerCase()) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= MAX_SHOWN) break;
    }
    return out;
  }, [fetched, suggestions, term]);

  function send(next) {
    clearTimeout(searchTimer.current);
    if (onSearch) onSearch(next);
  }

  function handleChange(text) {
    onChange(text);
    setOpen(true);
    setActive(-1);
    if (!onSearch) return;
    clearTimeout(searchTimer.current);
    const next = text.trim();
    // Emptied (typed away or the ✕): the full list, straight away.
    if (!next) {
      send("");
      return;
    }
    searchTimer.current = setTimeout(() => send(next), debounceMs);
  }

  function pick(text) {
    onChange(text);
    setOpen(false);
    setActive(-1);
    send(text);
  }

  function onKeyDown(e) {
    if (!open || shown.length === 0) {
      if (e.key === "ArrowDown" && shown.length) {
        setOpen(true);
        setActive(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? shown.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        send(term);
      }}
      className={`flex min-w-0 items-center gap-2 ${className}`}
    >
      <div className={`relative min-w-0 ${inputClassName}`}>
        <input
          type="search"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          title={title}
          autoComplete="off"
          className="w-full min-w-0 rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        {open && shown.length > 0 ? (
          <ul className="absolute left-0 z-30 mt-1 max-h-72 w-full min-w-[14rem] overflow-y-auto rounded-md border border-surface-border bg-white py-1 shadow-lg">
            {shown.map((text, i) => (
              <li key={text}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(text)}
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 ${
                    i === active ? "bg-surface" : "hover:bg-surface"
                  }`}
                  title={text}
                >
                  <Highlighted text={text} term={term} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {button && onSearch ? (
        <Button type="submit" variant="secondary" className="shrink-0">
          Search
        </Button>
      ) : null}
    </form>
  );
}
