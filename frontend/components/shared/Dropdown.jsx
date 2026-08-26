"use client";

import { useEffect, useRef, useState } from "react";

export default function Dropdown({ trigger, items, align = "left", disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <div
        onClick={() => !disabled && setOpen((o) => !o)}
        className={disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
      >
        {trigger}
      </div>
      {open ? (
        <div
          className={`absolute z-40 mt-1 min-w-[10rem] rounded-md border border-surface-border bg-white py-1 shadow-md ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((item) =>
            item.divider ? (
              <div key={item.key} className="my-1 border-t border-surface-border" />
            ) : (
              <button
                key={item.key ?? item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
