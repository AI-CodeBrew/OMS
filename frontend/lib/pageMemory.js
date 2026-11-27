"use client";

// Makes the browser's Back feel like Back: a list page comes back the way it
// was left - same page number, page size, search and filters (remembered
// for this browser tab's session), its last loaded rows shown straight away
// while a fresh copy loads, and the same scroll position.
//
// Everything is kept per signed-in account / operated store (accountKey) and
// per page path, so the Dispatch Hub's /orders and one store's /orders don't
// share a search.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import useAuthStore, { accountKey } from "../store/authStore";

const PREFIX = "pageMemory:";

function scopedKey(pathname, name) {
  return `${PREFIX}${accountKey(useAuthStore.getState())}|${pathname}|${name}`;
}

function readStored(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeStored(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full - the page just won't be remembered.
  }
}

/** useState that survives leaving the page and coming back (Back, or the
 * sidebar) within this browser tab. `name` is unique within the page.
 * `onArrival(value)`, if given, adjusts the value once when the page opens
 * (e.g. dates that must follow a link rather than the remembered ones). */
export function useRememberedState(name, initial, onArrival) {
  const pathname = usePathname();
  const key = scopedKey(pathname, name);
  const keyRef = useRef(key);
  keyRef.current = key;
  const [value, setValue] = useState(() => {
    const stored = readStored(key);
    let value = stored !== undefined ? stored : typeof initial === "function" ? initial() : initial;
    if (onArrival) {
      value = onArrival(value);
      writeStored(key, value);
    }
    return value;
  });
  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      writeStored(keyRef.current, resolved);
      return resolved;
    });
  }, []);
  return [value, set];
}

/** Forgets every remembered page (on logout - the next person at this
 * computer starts clean). */
export function clearPageMemory() {
  dataMemory.clear();
  try {
    Object.keys(window.sessionStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Storage unavailable - nothing was remembered there.
  }
}

// A page's last loaded data, in memory for this tab - shown at once on the
// way back while the page fetches a fresh copy.
const dataMemory = new Map();

export function useRememberedData(name) {
  const pathname = usePathname();
  const key = scopedKey(pathname, name);
  const recall = useCallback(() => dataMemory.get(key), [key]);
  const remember = useCallback((data) => dataMemory.set(key, data), [key]);
  return { recall, remember };
}

// ---- Scroll position ----------------------------------------------------

const scrollMemory = new Map();
const RESTORE_FOR_MS = 4000;

function locationKey() {
  return `${window.location.pathname}${window.location.search}`;
}

/** Remembers how far each page was scrolled and puts it back when the page
 * is reached with Back/Forward - once its rows have loaded far enough to
 * scroll there. `box` is the layout's own scrolling element (from a
 * callback ref - it can mount after the layout does); the window is
 * covered too (phones, and layouts that scroll the whole page). */
export function useScrollMemory(box) {
  const pathname = usePathname();
  // Set on Back/Forward: the position to go back to, read at that moment -
  // the old page is still on screen for a beat, and its scrolling would
  // otherwise overwrite what was saved for the page being returned to.
  const pendingTarget = useRef(null);

  useEffect(() => {
    const onPop = () => {
      pendingTarget.current = scrollMemory.get(locationKey()) || null;
    };
    const onScroll = () => {
      scrollMemory.set(locationKey(), {
        box: box ? box.scrollTop : 0,
        win: window.scrollY,
      });
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("scroll", onScroll, { passive: true });
    box?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("scroll", onScroll);
      box?.removeEventListener("scroll", onScroll);
    };
  }, [box]);

  useEffect(() => {
    const target = pendingTarget.current;
    pendingTarget.current = null;
    if (!target || (!target.box && !target.win)) return undefined;

    // The rows may still be loading - keep trying until the page is tall
    // enough, the user scrolls themselves, or a few seconds pass.
    let frame = 0;
    let stopped = false;
    const started = Date.now();
    const stop = () => {
      stopped = true;
    };
    const tryRestore = () => {
      if (stopped) return;
      let done = true;
      if (box && target.box) {
        if (box.scrollHeight - box.clientHeight >= target.box) box.scrollTop = target.box;
        else done = false;
      }
      if (target.win) {
        const page = document.scrollingElement || document.documentElement;
        if (page.scrollHeight - window.innerHeight >= target.win) window.scrollTo(0, target.win);
        else done = false;
      }
      if (!done && Date.now() - started < RESTORE_FOR_MS) frame = requestAnimationFrame(tryRestore);
    };
    frame = requestAnimationFrame(tryRestore);
    const userEvents = ["wheel", "touchstart", "keydown", "mousedown"];
    userEvents.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      userEvents.forEach((e) => window.removeEventListener(e, stop));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
