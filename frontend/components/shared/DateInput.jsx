"use client";

import { useEffect, useRef, useState } from "react";

// "2026-10-29" <-> "29/10/2026". The value stays yyyy-mm-dd everywhere
// (what the API takes); only what's shown and typed is dd/mm/yyyy.
export function formatDmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function parseDmy(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Typing digits only: "29102026" -> "29/10/2026".
function withSlashes(text) {
  if (text.includes("/")) return text;
  const digits = text.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
}

/**
 * A date box that always shows dd/mm/yyyy - a native <input type="date">
 * shows the computer's own format (mm/dd/yyyy on a US-set Windows). A
 * drop-in for it: `value` is yyyy-mm-dd and onChange gets an event-like
 * { target: { value } }. Type the date, or pick it from the calendar.
 */
export default function DateInput({
  value,
  onChange,
  className = "",
  required = false,
  disabled = false,
  min,
  max,
  id,
  name,
  "aria-label": ariaLabel,
}) {
  const [text, setText] = useState(formatDmy(value));
  const pickerRef = useRef(null);

  useEffect(() => {
    setText(formatDmy(value));
  }, [value]);

  function emit(iso) {
    onChange?.({ target: { value: iso, name } });
  }

  function onType(e) {
    const next = withSlashes(e.target.value);
    setText(next);
    if (!next.trim()) emit("");
    else {
      const iso = parseDmy(next);
      if (iso) emit(iso);
    }
  }

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker || disabled) return;
    try {
      picker.showPicker();
    } catch {
      picker.focus();
      picker.click();
    }
  }

  return (
    <div className={`relative ${className.includes("w-full") ? "block" : "inline-block"}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        pattern="\d{1,2}/\d{1,2}/\d{4}"
        title="Date as dd/mm/yyyy"
        value={text}
        onChange={onType}
        // A half-typed date goes back to the last good one.
        onBlur={() => setText(formatDmy(value))}
        className={`${className} pr-8`}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label="Open calendar"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {/* The browser's calendar, opened by the button; never shown itself. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ""}
        min={min}
        max={max}
        onChange={(e) => emit(e.target.value)}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </div>
  );
}
