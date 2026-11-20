"use client";

import { useEffect, useRef, useState } from "react";
import {
  CameraViewport,
  CheckIcon,
  CloseIcon,
  CrossIcon,
  useBarcodeCamera,
  useBeeper,
} from "../../components/wms/barcodeCamera";
import ReturnBreakdownModal from "../../components/wms/ReturnBreakdownModal";
import { PHONE_SCAN_CALLS, receiveReturn, ScanSessionEndedError } from "../../lib/phoneScanApi";
import { describeScanOutcome, SCAN_DESKS } from "../../lib/scanDesks";
import { connectScanSession } from "../../lib/scanSessionSocket";

const CAMERA_ELEMENT_ID = "phone-scan-camera";
const MIN_CODE_LENGTH = 3;
// The camera re-reads a barcode on every frame it's in view, so the same code
// only counts again once it has been out of view this long - holding a parcel
// still must not send it twice.
const SAME_CODE_GAP_MS = 2000;
// Kept on this phone only, newest first - enough for a long shift, bounded so
// an all-day session can't grow without limit.
const HISTORY_LIMIT = 500;
// The desk the laptop last pointed this phone at, kept for this tab so a
// reload with the laptop shut still knows what it's scanning for.
const DESK_STORAGE_KEY = "oms.phoneScan.desk";
// How long the connection must stay open before its token counts as accepted.
// A refused token (an old QR code, an ended session) is closed by the backend
// within milliseconds of opening; a QR code's token is confirmed at once by the
// "session" frame that swaps it for the lasting one.
const LINK_CONFIRM_MS = 1500;
const NO_DESK = { id: "", title: "", field: "" };

// A square scan box, as large as the camera area allows. Square suits QR codes
// and still spans the width a long 1D barcode needs.
function squareQrbox(viewfinderWidth, viewfinderHeight) {
  const side = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.9);
  return { width: side, height: side };
}

function newEntryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readSavedDesk() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DESK_STORAGE_KEY) || "null");
    return saved && SCAN_DESKS[saved.id] ? saved : NO_DESK;
  } catch {
    return NO_DESK; // Blocked storage - the laptop's next hello says it again.
  }
}

function saveDesk(desk) {
  try {
    if (desk.id) window.sessionStorage.setItem(DESK_STORAGE_KEY, JSON.stringify(desk));
    else window.sessionStorage.removeItem(DESK_STORAGE_KEY);
  } catch {
    // As above.
  }
}

// The laptop's hello names its desk. A laptop page loaded before hello carried
// the desk's id is matched by its title instead.
function deskFromHello(frame) {
  const id = SCAN_DESKS[frame.desk]
    ? frame.desk
    : Object.values(SCAN_DESKS).find((d) => d.title === frame.title)?.deskId || "";
  return { id, title: frame.title || "", field: frame.field || "" };
}

// The phone's end of the laptop's Scan panel, opened from its QR code - no
// login here on purpose. The token after the # stands in for one: this page
// makes the scan calls itself with it (lib/phoneScanApi.js), as the login and
// store the laptop had when Scan was pressed, so scanning carries on with the
// laptop asleep or shut. The laptop, while open, picks the desk and hears of
// every scan (lib/phoneScanSession.js). Only the cross here ends it.
export default function PhoneScanPage() {
  const [token, setToken] = useState(null);
  const [started, setStarted] = useState(false);
  // The operator pressed the cross - the only thing that ends this session.
  const [closed, setClosed] = useState(false);
  // The laptop's side: "connecting", "waiting" (no laptop on the session),
  // "ready", "expired" (an old QR code) or "ended" (the session was ended).
  // Only the last two stop scanning - a laptop asleep or shut doesn't.
  const [link, setLink] = useState("connecting");
  // The token in hand has been accepted by the backend - scans wait for this,
  // so a scan never goes out on an old QR code (user, 2026-11-20: the first
  // scan after opening an old code came back "session ended").
  const [linked, setLinked] = useState(false);
  const linkedRef = useRef(false);
  const linkTimerRef = useRef(null);
  const [desk, setDesk] = useState(NO_DESK);
  const [card, setCard] = useState(null);
  // The returned parcel being counted here: { orderNumber, lines }. Scanning
  // waits until it's confirmed or cancelled, same as the laptop's popup.
  const [counting, setCounting] = useState(null);
  // Every code scanned or typed here and how it went: { id, code, title, tone:
  // "pending" | "success" | "error" | "info", message, manual, at, retry }
  // (retry: what its Retry button sends again - see showOutcome).
  const [history, setHistory] = useState([]);
  const [manualCode, setManualCode] = useState("");
  const manualInputRef = useRef(null);

  const beep = useBeeper(false);
  const sessionRef = useRef(null);
  // What the APIs are called with - the lasting token once the socket hands
  // it over (the QR code's own only lasts a minute or so).
  const tokenRef = useRef(null);
  const deskRef = useRef(desk);
  deskRef.current = desk;
  const countingRef = useRef(counting);
  countingRef.current = counting;
  // { entryId } while a scan is in flight - one at a time, like the laptop's
  // panel, so a parcel held in view can't be sent twice.
  const pendingRef = useRef(null);
  // The history row of the parcel being counted (see `counting`).
  const countEntryRef = useRef(null);
  // Returns confirmed here and still being recorded in the background:
  // order number -> its history row. Scanning one of them again mustn't open
  // a second count - its lookup can't see the first receive yet.
  const receivingRef = useRef(new Map());
  // The history row the result card is currently about, so a background
  // receive finishing late doesn't replace a newer parcel's card.
  const cardEntryRef = useRef(null);
  const lastCodeRef = useRef({ code: "", at: 0 });
  // Bumped when this page moves to another session or stops, so a reply still
  // in flight from before is dropped.
  const runRef = useRef(0);

  useEffect(() => {
    const first = window.location.hash.slice(1);
    tokenRef.current = first;
    setToken(first);
    setDesk(readSavedDesk());

    // A new QR code opened in a tab already on this page only changes what's
    // after the #, which doesn't reload it - without this it would sit on the
    // old "Scanner closed" screen. (replaceState below doesn't fire this.)
    function onHashChange() {
      const next = window.location.hash.slice(1);
      if (!next) return;
      runRef.current += 1;
      pendingRef.current = null;
      receivingRef.current.clear();
      cardEntryRef.current = null;
      setCard(null);
      setCounting(null);
      setHistory([]);
      countEntryRef.current = null;
      setDesk(NO_DESK);
      saveDesk(NO_DESK);
      setLink("connecting");
      setClosed(false);
      clearTimeout(linkTimerRef.current);
      markLinked(false);
      tokenRef.current = next;
      setToken(next);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function markLinked(value) {
    linkedRef.current = value;
    setLinked(value);
  }

  function vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Not every phone can - iPhones don't.
    }
  }

  function updateEntry(id, patch) {
    if (!id) return;
    setHistory((list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  // Stops everything in flight and forgets the desk - shared by the two ways
  // this phone's part ends.
  function stopRunning() {
    runRef.current += 1;
    pendingRef.current = null;
    receivingRef.current.clear();
    countEntryRef.current = null;
    saveDesk(NO_DESK);
    setCounting(null);
  }

  // Ends this phone's part for good, and drops its token from the address bar
  // so not even a reload can bring it back.
  function finish() {
    stopRunning();
    window.history.replaceState(null, "", window.location.pathname);
    setCard(null);
    setStarted(false);
    setClosed(true);
  }

  // The backend refused the token: the session was ended, or it predates
  // phones making their own calls. Either way only a new QR code helps.
  function sessionEnded() {
    stopRunning();
    setLink("ended");
  }

  const handlersRef = useRef(null);
  handlersRef.current = { finish };

  useEffect(() => {
    if (!token || closed) return undefined;

    const session = connectScanSession(token, {
      onOpen: () => {
        setLink("waiting");
        // Still open a moment later = the backend accepted this token.
        clearTimeout(linkTimerRef.current);
        linkTimerRef.current = setTimeout(() => markLinked(true), LINK_CONFIRM_MS);
      },
      onFrame: (frame) => {
        if (frame.type === "session" || frame.type === "hello" || frame.type === "host_joined") {
          clearTimeout(linkTimerRef.current);
          markLinked(true);
        }
        if (frame.type === "session") {
          // The QR code's token only lasts 2 minutes. Reconnects, API
          // calls and a reload of this page need the lasting one from here on.
          tokenRef.current = frame.token;
          sessionRef.current?.setToken(frame.token);
          window.history.replaceState(null, "", `#${frame.token}`);
        } else if (frame.type === "hello") {
          setLink("ready");
          const next = deskFromHello(frame);
          setDesk(next);
          saveDesk(next);
        } else if (frame.type === "host_joined") {
          // The laptop is back - it needs to hear we're still here.
          sessionRef.current?.send({ type: "here" });
        } else if (frame.type === "host_left") {
          setLink("waiting");
          // A refreshing laptop's old connection can report leaving after its
          // new one has already joined - if so, this gets a hello straight back.
          sessionRef.current?.send({ type: "here" });
        } else if (frame.type === "ended") {
          // The cross was pressed on another scanner tab of this session.
          handlersRef.current.finish();
        }
      },
      onDown: () => {
        clearTimeout(linkTimerRef.current);
        setLink("connecting");
      },
      // Refused: a token that was working belongs to a session that has
      // ended; one never accepted is an old QR code.
      onRejected: () => {
        clearTimeout(linkTimerRef.current);
        setLink(linkedRef.current ? "ended" : "expired");
      },
    });
    sessionRef.current = session;

    return () => {
      clearTimeout(linkTimerRef.current);
      sessionRef.current = null;
      session.close();
    };
  }, [token, closed]);

  function closeScanner() {
    sessionRef.current?.send({ type: "end" });
    finish();
  }

  // Tells the laptop, if it's there, so its log and lists show this scan as
  // if it had been made on it. Nothing depends on it arriving.
  function report(deskId, entry) {
    sessionRef.current?.send({ type: "done", desk: deskId, entry });
  }

  function showCard(entryId, card) {
    cardEntryRef.current = entryId;
    setCard(card);
  }

  // `background`: a result arriving after the operator may have moved on to
  // the next parcel. Its row is always updated, but a success only takes the
  // card (and beeps) if nothing newer has - a failure always does, so it
  // can't go unnoticed.
  // `retry`: what the row's Retry button sends again - only for a request
  // that got no answer (no connection, timeout, server error). A refusal the
  // server did answer ("not Returned", "Already received") gets none: it
  // would only answer the same.
  function showOutcome(entryId, success, title, message, { background = false, retry = null } = {}) {
    const text = message || (success ? "Done" : "Failed");
    updateEntry(entryId, { tone: success ? "success" : "error", title, message: text, retry });
    if (background && success && cardEntryRef.current !== entryId) return;
    showCard(entryId, { tone: success ? "success" : "error", title, message: text });
    beep(success ? "success" : "error");
    vibrate(success ? 80 : [200, 80, 200]);
  }

  // A scan call's answer - the same handling the laptop gives its own scans.
  function settleScan(entryId, deskId, code, response) {
    const deskConfig = SCAN_DESKS[deskId];
    const entry = { ...response, order_number: response.order_number || code };
    // Confirmed a moment ago and still being recorded: its lookup can't see
    // that yet, and a second count would only fail.
    if (entry.success && deskConfig.phoneCount && receivingRef.current.has(entry.order_number)) {
      const message = "Already being received - its result will show in the list.";
      updateEntry(entryId, { tone: "info", title: entry.order_number, message });
      showCard(entryId, { tone: "info", title: entry.order_number, message });
      beep("error");
      return;
    }
    // Found, but only received once it's counted on this phone.
    if (entry.success && deskConfig.phoneCount) {
      showCard(entryId, null);
      countEntryRef.current = entryId;
      updateEntry(entryId, { title: entry.order_number, message: "Counting on this phone…" });
      setCounting({ orderNumber: entry.order_number, lines: entry.lines || [] });
      beep("success");
      vibrate(80);
      return;
    }
    report(deskId, entry);
    showOutcome(entryId, Boolean(entry.success), entry.order_number, describeScanOutcome(deskConfig, entry));
  }

  // Scans one code - camera-read, typed, or a failed row's Retry, which
  // passes that row (`entryId`) and the desk it was scanned for.
  function runScan(code, { manual = false, deskId = deskRef.current.id, entryId: retryOf = null } = {}) {
    const call = PHONE_SCAN_CALLS[deskId];
    if (!call) return;

    const run = runRef.current;
    const entryId = retryOf || newEntryId();
    lastCodeRef.current = { code, at: Date.now() };
    pendingRef.current = { entryId };
    showCard(entryId, { tone: "info", title: code, message: "Checking…" });
    if (retryOf) {
      updateEntry(entryId, { tone: "pending", message: "Checking…", retry: null });
    } else {
      setHistory((list) =>
        [{ id: entryId, code, title: code, tone: "pending", message: "Checking…", manual, at: new Date() }, ...list].slice(
          0,
          HISTORY_LIMIT
        )
      );
    }

    call(tokenRef.current, code)
      .then((response) => {
        if (run === runRef.current) settleScan(entryId, deskId, code, response);
      })
      .catch((err) => {
        if (run !== runRef.current) return;
        if (err instanceof ScanSessionEndedError) sessionEnded();
        else
          showOutcome(entryId, false, code, err.message || "Scan failed", {
            retry: { kind: "scan", deskId, code },
          });
      })
      .finally(() => {
        if (run === runRef.current && pendingRef.current?.entryId === entryId) pendingRef.current = null;
      });
  }

  // Records a counted return in the background - from the count form's
  // Confirm, or a failed receive's Retry (`retrying`). Its row shows
  // "Receiving…" until the answer comes.
  function sendReceive(entryId, orderNumber, breakdown, { retrying = false } = {}) {
    const run = runRef.current;
    receivingRef.current.set(orderNumber, entryId);
    updateEntry(entryId, { tone: "pending", title: orderNumber, message: "Receiving…", retry: null });
    showCard(entryId, { tone: "info", title: orderNumber, message: "Receiving…" });

    receiveReturn(tokenRef.current, orderNumber, breakdown)
      .then((response) => {
        if (run !== runRef.current) return;
        const entry = { ...response, order_number: response.order_number || orderNumber };
        report("returns", entry);
        if (retrying && !entry.success && entry.reason === "Already received") {
          // The earlier try most likely went through and only its answer was
          // lost - not a failure to show in red.
          const message = "Already received - most likely by the earlier try. Check it on the laptop.";
          updateEntry(entryId, { tone: "info", title: entry.order_number, message });
          if (cardEntryRef.current === entryId) showCard(entryId, { tone: "info", title: entry.order_number, message });
          return;
        }
        const message = describeScanOutcome(SCAN_DESKS.returns, entry);
        showOutcome(
          entryId,
          Boolean(entry.success),
          entry.order_number,
          entry.success ? message : `Not received - ${message || "could not record this count."}`,
          { background: true }
        );
      })
      .catch((err) => {
        if (run !== runRef.current) return;
        if (err instanceof ScanSessionEndedError) {
          sessionEnded();
          return;
        }
        showOutcome(entryId, false, orderNumber, `Not received - ${err.message || "could not record this count."}`, {
          background: true,
          retry: { kind: "receive", orderNumber, breakdown },
        });
      })
      .finally(() => {
        if (receivingRef.current.get(orderNumber) === entryId) receivingRef.current.delete(orderNumber);
      });
  }

  // The count form's Confirm. The form closes straight away and the receive
  // runs in the background, so the next parcel can be scanned meanwhile. The
  // scan's lookup already checked the parcel is receivable, so this rarely
  // fails; when it does (received elsewhere in between, no connection) its
  // row turns red with the reason, with the error beep.
  function confirmCount(breakdown) {
    const current = countingRef.current;
    if (!current) return;
    const entryId = countEntryRef.current;
    setCounting(null);
    countEntryRef.current = null;
    sendReceive(entryId, current.orderNumber, breakdown);
  }

  // A failed row's Retry: the same request again, without scanning or
  // counting the parcel again.
  function retryEntry(entry) {
    const { retry } = entry;
    if (!retry) return;
    if (retry.kind === "receive") {
      if (!receivingRef.current.has(retry.orderNumber)) {
        sendReceive(entry.id, retry.orderNumber, retry.breakdown, { retrying: true });
      }
      return;
    }
    if (pendingRef.current || countingRef.current) {
      showCard(entry.id, {
        tone: "info",
        title: retry.code,
        message: "Finish the current parcel first, then retry this one.",
      });
      return;
    }
    runScan(retry.code, { deskId: retry.deskId, entryId: entry.id });
  }

  function handleDecode(raw) {
    const code = (raw || "").trim();
    if (code.length < MIN_CODE_LENGTH) return;

    const now = Date.now();
    const last = lastCodeRef.current;
    if (code === last.code) {
      const stillInView = now - last.at < SAME_CODE_GAP_MS;
      last.at = now;
      if (stillInView) return;
    }
    if (pendingRef.current || countingRef.current || !deskRef.current.id || !linkedRef.current) return;

    runScan(code);
  }

  // For a label the camera can't read: the tracking number typed in instead.
  // Unlike the camera, every refusal is said out loud - the operator pressed
  // a button and needs to know why nothing happened.
  function submitManual(event) {
    event.preventDefault();
    const code = manualCode.trim();
    const field = (desk.field || "tracking number").toLowerCase();
    if (code.length < MIN_CODE_LENGTH) {
      setCard({ tone: "error", message: `Enter the full ${field}.` });
      return;
    }
    if (countingRef.current) return; // the count popup is open over this
    if (!linkedRef.current) {
      setCard({
        tone: "info",
        title: code,
        message: "Still connecting to the laptop's scan session - submit again in a moment.",
      });
      return;
    }
    if (!deskRef.current.id) {
      setCard({
        tone: "error",
        title: code,
        message: "Waiting for the laptop to say what to scan for. Submit again once it's connected.",
      });
      return;
    }
    if (pendingRef.current) {
      setCard({ tone: "info", title: code, message: "Wait for the last parcel's result, then submit again." });
      return;
    }
    runScan(code, { manual: true });
    setManualCode("");
    manualInputRef.current?.blur(); // drops the keyboard so the result is in view
  }

  // The count popup closed without a confirm - the parcel wasn't received.
  function cancelCount() {
    updateEntry(countEntryRef.current, { tone: "info", message: "Not received - the count was cancelled." });
    countEntryRef.current = null;
    setCounting(null);
  }

  const camera = useBarcodeCamera({
    open: started && link !== "expired" && link !== "ended",
    elementId: CAMERA_ELEMENT_ID,
    onDecode: handleDecode,
    qrbox: squareQrbox,
    highResolution: true,
  });
  const restartCamera = camera.retry;

  // Scanning means long stretches without touching the screen, so keep it on
  // (best-effort). A phone locked anyway loses both the wake lock and, on some
  // phones, the camera feed - both are taken again on return, so the work
  // carries on where it stopped.
  useEffect(() => {
    if (!started) return undefined;
    let lock = null;
    let cancelled = false;

    async function keepAwake() {
      try {
        const next = await navigator.wakeLock?.request("screen");
        if (cancelled) next?.release();
        else lock = next;
      } catch {
        // Unsupported or refused - the screen just follows its normal timeout.
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      keepAwake();
      restartCamera();
    }

    keepAwake();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      lock?.release();
    };
  }, [started, restartCamera]);

  if (token === "" || link === "expired" || link === "ended") {
    return (
      <PhoneMessage>
        {token === ""
          ? "This link is incomplete. Press Scan on the laptop and scan the code showing there now."
          : link === "ended"
            ? "This scan session has ended (its ✕ was pressed). Press Scan on the laptop and scan the code showing there now."
            : "This QR code is old. Press Scan on the laptop and scan the new code showing there."}
      </PhoneMessage>
    );
  }

  if (closed) {
    return (
      <PhoneMessage>
        Scanner closed. You can close this tab now. To scan again, scan the QR code on the laptop.
      </PhoneMessage>
    );
  }

  if (!started) {
    return (
      <PhoneMessage>
        <p className="mb-4">{desk.title || "Phone scanner"}</p>
        <button
          type="button"
          onClick={() => {
            // This tap is what lets the browser play the scan beeps at all,
            // so it doubles as a sound check.
            beep("success");
            setStarted(true);
          }}
          className="w-full rounded-md bg-brand-800 px-4 py-3 text-sm font-semibold text-white"
        >
          Start scanning
        </button>
      </PhoneMessage>
    );
  }

  // Scanning only waits on the laptop until it has said what to scan for -
  // after that it carries on whether the laptop is there or not.
  const linkMessage = !linked
    ? "Connecting to the laptop's scan session…"
    : desk.id
    ? null
    : link === "connecting"
      ? "Connecting…"
      : "Waiting for the laptop - open the system there in the same browser tab. No new QR code needed.";
  const laptopAway = Boolean(desk.id) && link !== "ready";

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{desk.title || "Phone scanner"}</p>
          {laptopAway ? (
            <p className="text-xs text-amber-300">Laptop offline - scanning carries on.</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={closeScanner}
          aria-label="Close scanner"
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <CloseIcon />
        </button>
      </div>

      <form onSubmit={submitManual} className="flex gap-2 px-4 pb-3">
        <input
          ref={manualInputRef}
          type="text"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder={`Type ${(desk.field || "tracking number").toLowerCase()}`}
          aria-label={`Type the ${(desk.field || "tracking number").toLowerCase()}`}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          // 16px+ text, or iPhones zoom the page in on focus.
          className="min-w-0 flex-1 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder:text-slate-400 focus:border-brand-300 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!manualCode.trim()}
          className="shrink-0 rounded-md bg-brand-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Submit
        </button>
      </form>

      {/* A fixed height, so the list growing below never resizes the camera
          (the scan box is laid out once, when the camera opens). */}
      <CameraViewport
        id={CAMERA_ELEMENT_ID}
        className="relative h-[min(52vh,100vw)] w-full shrink-0 overflow-hidden bg-slate-900"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-black px-4 py-3">
        <p className={`text-center text-sm ${camera.status === "error" ? "text-red-400" : "text-slate-300"}`}>
          {camera.status === "loading"
            ? "Opening camera…"
            : camera.status === "error"
              ? camera.error
              : linkMessage || `Point the camera at the ${(desk.field || "parcel").toLowerCase()} barcode.`}
          {camera.status === "error" ? (
            <button
              type="button"
              onClick={camera.retry}
              className="ml-2 font-medium text-brand-300 underline"
            >
              Try again
            </button>
          ) : null}
        </p>
        {card ? <ResultCard card={card} /> : null}
        <ScanHistory entries={history} onRetry={retryEntry} />
      </div>

      <ReturnBreakdownModal
        request={counting}
        onConfirm={confirmCount}
        onClose={cancelCount}
      />
    </div>
  );
}

function PhoneMessage({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6 text-center text-sm text-white">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function ResultCard({ card }) {
  const toneClass = {
    success: "border-green-200 bg-green-50 text-green-800",
    error: "border-red-200 bg-red-50 text-red-700",
    info: "border-slate-200 bg-slate-50 text-slate-700",
  }[card.tone];

  return (
    <div className={`flex items-start gap-3 rounded-md border px-3 py-3 ${toneClass}`}>
      {card.tone === "success" ? <CheckIcon /> : null}
      {card.tone === "error" ? <CrossIcon /> : null}
      <div className="min-w-0 flex-1">
        {card.title ? <p className="break-all text-sm font-semibold">{card.title}</p> : null}
        <p className="text-xs">{card.message}</p>
      </div>
    </div>
  );
}

const HISTORY_DOT = {
  success: "bg-green-400",
  error: "bg-red-400",
  info: "bg-slate-400",
  pending: "animate-pulse bg-amber-300",
};

// What this phone has scanned, newest first, under the camera - scrolls on
// its own so the camera and the latest result stay put.
function ScanHistory({ entries, onRetry }) {
  const done = entries.filter((e) => e.tone === "success").length;
  const failed = entries.filter((e) => e.tone === "error").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between border-b border-white/10 pb-2">
        <p className="text-sm font-semibold text-white">Scanned ({entries.length})</p>
        <p className="text-xs">
          <span className="text-green-400">{done} done</span>
          <span className="text-slate-500"> · </span>
          <span className="text-red-400">{failed} failed</span>
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">Scanned parcels will be listed here.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto overscroll-contain">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-2">
              <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${HISTORY_DOT[entry.tone]}`} />
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium text-white">{entry.title}</p>
                {entry.message ? <p className="text-xs text-slate-400">{entry.message}</p> : null}
                {entry.tone === "error" && entry.retry ? (
                  <button
                    type="button"
                    onClick={() => onRetry(entry)}
                    className="mt-1.5 rounded-md border border-white/25 px-3 py-1 text-xs font-semibold text-white hover:bg-white/10"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-[11px] leading-4 text-slate-500">
                <p>{entry.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                {entry.manual ? <p>Typed</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
