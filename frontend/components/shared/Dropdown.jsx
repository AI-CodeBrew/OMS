"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Dropdown({ trigger, items, align = "left", disabled = false }) {
  const [open, setOpen] = useState(false);
  // Menu coordinates in viewport space. Null until measured, which is what
  // keeps the first paint from flashing in the wrong spot.
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Drop upwards when the menu would run off the bottom of the viewport
    // and there is more room above - e.g. the last row of a long table.
    const flipUp = menuHeight > 0 && spaceBelow < menuHeight + 8 && rect.top > spaceBelow;
    setPos({
      top: flipUp ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4,
      left: align === "right" ? null : rect.left,
      right: align === "right" ? window.innerWidth - rect.right : null,
    });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(e) {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inTrigger && !inMenu) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    // Capture phase so scrolling *any* ancestor (the orders table's own
    // scroll container included) keeps the menu glued to its trigger.
    function onReflow() {
      place();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, place]);

  // Rendered into <body> rather than next to the trigger: row menus live
  // inside the orders table's `overflow-auto` scroll box, which clipped the
  // menu away entirely whenever the table was shorter than the menu (one
  // or two visible orders).
  const menu = (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? undefined,
        right: pos?.right ?? undefined,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-50 min-w-[10rem] rounded-md border border-surface-border bg-white py-1 shadow-md"
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
  );

  return (
    <div className="relative inline-block">
      <div
        ref={triggerRef}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
      >
        {trigger}
      </div>
      {open && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}
