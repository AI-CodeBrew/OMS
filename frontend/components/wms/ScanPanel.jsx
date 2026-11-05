"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button from "../shared/Button";
import { CameraViewport, CheckIcon, CloseIcon, CrossIcon, useBarcodeCamera, useBeeper } from "./barcodeCamera";
import PhoneScanPairing from "./PhoneScanPairing";
import { describeScanOutcome, SCAN_DESKS } from "../../lib/scanDesks";
import {
  claimPhoneDesk,
  closePhoneScanner,
  openPhoneScanner,
  retryPhoneScanner,
  usePhoneScanStore,
} from "../../lib/phoneScanSession";

// A barcode gun fires its whole payload in a few milliseconds per keystroke;
// a person types an order of magnitude slower. Used only to label an entry
// as scanned vs typed - it never blocks a submit.
const SCANNER_KEY_INTERVAL_MS = 50;
// Guns commonly double-fire the same code, and a phone camera re-decodes
// the same barcode on every frame it's held in view - both look like the
// same code arriving over and over. Re-reading it this soon is treated as
// the same parcel and ignored, rather than reported as an "already
// received" failure the operator has to interpret.
const DUPLICATE_WINDOW_MS = 2000;
const MIN_CODE_LENGTH = 3;
const MUTE_STORAGE_KEY = "oms.scanPanel.muted";

// A touch-first device is the phone itself, so Scan opens its camera directly;
// anything with a mouse gets the QR code that hands scanning to a phone.
function isTouchDevice() {
  return Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}

function SoundIcon({ muted }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <path d="M11 5L6 9H2v6h4l5 4V5z" strokeLinecap="round" strokeLinejoin="round" />
      {muted ? (
        <path d="M23 9l-6 6M17 9l6 6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path
        d="M4 8a2 2 0 012-2h1.5l1-1.5h7l1 1.5H18a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/**
 * Barcode station shared by the Returns Desk, the Packing bench, and the
 * Orders page's pack and dispatch popups.
 *
 * onScan(code) must resolve to the {success, order_number, reason} shape
 * the wms scan endpoints return; whatever it resolves to is handed
 * straight to renderSuccess for the detail line. `code` is a tracking
 * number (what's actually printed as a barcode on a parcel's courier
 * label) - see fieldLabel below.
 *
 * Every way in lands on submit() below - a barcode gun's keystrokes, this
 * device's camera, or a paired phone's camera - so the flow after it is the
 * same for all of them. deskId names its entry in lib/scanDesks.js, which is
 * what a paired phone keeps scanning for once this panel is closed.
 */
export default function ScanPanel({
  deskId,
  title,
  hint,
  actionLabel = "Submit",
  fieldLabel = "Order number",
  onScan,
  renderSuccess,
  onAfterSuccess,
  decision,
  autoFocusInput = false,
}) {
  // The camera only ever opens from an explicit tap on the Scan button
  // below - never on mount/default, so landing on the page doesn't throw
  // an unexpected camera-permission prompt at anyone.
  const [scannerOpen, setScannerOpen] = useState(false);
  // Scan on a laptop: the QR code and phone connection instead of the camera.
  const [pairingOpen, setPairingOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const [muted, setMuted] = useState(false);
  // Set only when `decision` is provided and a scan just found a
  // receivable parcel - the panel pauses here, showing the tick plus the
  // decision's own buttons, until one is picked. Undefined `decision`
  // (e.g. the Packing station) means this never gets set and the panel
  // behaves exactly as it always has.
  const [pendingDecision, setPendingDecision] = useState(null);

  const inputRef = useRef(null);
  const keyTimesRef = useRef([]);
  const lastSubmitRef = useRef({ code: "", at: 0 });
  // Colons stripped - safe for both getElementById and any internal
  // querySelector the camera library might use, React's default useId()
  // format includes them.
  const cameraElementId = `scan-camera-${useId().replace(/:/g, "")}`;
  const beep = useBeeper(muted);

  // Camera detections have no keystrokes to time - they're always a real
  // scan, never "typed".
  const camera = useBarcodeCamera({
    open: scannerOpen,
    elementId: cameraElementId,
    onDecode: (decodedText) => submit(decodedText, { forceScanned: true }),
  });

  const phone = usePhoneScanStore();
  const phoneHasPaired = ["paired", "away", "reconnecting"].includes(phone.status);
  const showPairing = pairingOpen || (phoneHasPaired && phone.deskId === deskId);
  const phoneElsewhere = phoneHasPaired && phone.deskId && phone.deskId !== deskId;

  const handlePhoneCodeRef = useRef(handlePhoneCode);
  handlePhoneCodeRef.current = handlePhoneCode;
  useEffect(() => claimPhoneDesk(deskId, (code) => handlePhoneCodeRef.current(code)), [deskId]);

  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_STORAGE_KEY) === "1");
    } catch {
      // Private mode / blocked storage - default to sound on.
    }
  }, []);

  function toggleMuted() {
    setMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Preference just won't persist; the toggle still works this session.
      }
      return next;
    });
  }

  function wasScanned() {
    const times = keyTimesRef.current;
    if (times.length < MIN_CODE_LENGTH) return false;
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    return gaps.every((gap) => gap < SCANNER_KEY_INTERVAL_MS);
  }

  // Resolves to the entry it recorded, or {ignored: "busy" | "repeat"} when
  // the code didn't count as a scan - the phone needs to hear either way.
  async function submit(raw, { forceScanned } = {}) {
    // The current parcel's decision must be resolved before the next one
    // can be scanned - otherwise a Good/Bad click could land on the wrong
    // parcel. The busy guard matters here specifically for the camera,
    // which keeps decoding frames continuously - without it, holding a
    // barcode in view a moment too long would fire a second submit while
    // the first is still in flight.
    if (pendingDecision || busy) return { ignored: "busy" };

    const code = (raw || "").trim();
    const scanned = forceScanned !== undefined ? forceScanned : wasScanned();

    if (code.length < MIN_CODE_LENGTH) {
      // A half-read barcode or a stray Enter - clear and wait rather than
      // firing a request that can only fail.
      setValue("");
      keyTimesRef.current = [];
      return { ignored: "repeat" };
    }

    const now = Date.now();
    if (code === lastSubmitRef.current.code && now - lastSubmitRef.current.at < DUPLICATE_WINDOW_MS) {
      setValue("");
      keyTimesRef.current = [];
      return { ignored: "repeat" };
    }
    lastSubmitRef.current = { code, at: now };

    setBusy(true);
    try {
      const response = await onScan(code);
      const orderNumber = response.order_number || code;

      if (response.success && decision) {
        // Pause here instead of finalizing - the tick shows now, but
        // nothing is recorded (and the log line isn't written) until the
        // operator picks an outcome below.
        const pendingEntry = { ...response, order_number: orderNumber, scanned, at: new Date(), pending: true };
        setResult(pendingEntry);
        setPendingDecision({ orderNumber, scanned });
        beep("success");
        return pendingEntry;
      }

      const entry = { ...response, order_number: orderNumber, scanned, at: new Date() };
      setResult(entry);
      setLog((prev) => [entry, ...prev].slice(0, 12));
      beep(entry.success ? "success" : "error");
      if (entry.success) await onAfterSuccess?.();
      return entry;
    } catch (err) {
      const entry = {
        success: false,
        order_number: code,
        reason: err.message || "Scan failed",
        scanned,
        at: new Date(),
      };
      setResult(entry);
      setLog((prev) => [entry, ...prev].slice(0, 12));
      beep("error");
      return entry;
    } finally {
      setBusy(false);
      setValue("");
      keyTimesRef.current = [];
      inputRef.current?.focus();
    }
  }

  // A code from the paired phone: the normal scan, with its outcome worded
  // for the phone's screen.
  async function handlePhoneCode(code) {
    const outcome = await submit(code, { forceScanned: true });
    if (outcome.ignored) {
      return {
        status: "ignored",
        order_number: code,
        message: outcome.ignored === "busy" ? "Laptop is busy with the last parcel - scan this one again." : "",
      };
    }
    return {
      status: outcome.success ? "ok" : "fail",
      order_number: outcome.order_number,
      message: outcome.pending ? `${decision.prompt} (choose on the laptop)` : outcomeText(outcome),
    };
  }

  async function resolveDecision(choice) {
    if (!pendingDecision) return;
    const { orderNumber, scanned } = pendingDecision;
    setBusy(true);
    try {
      const response = await decision.onDecide(orderNumber, choice);
      const entry = { ...response, order_number: response.order_number || orderNumber, scanned, at: new Date() };
      setResult(entry);
      setLog((prev) => [entry, ...prev].slice(0, 12));
      beep(entry.success ? "success" : "error");
      if (entry.success) await onAfterSuccess?.();
    } catch (err) {
      const entry = {
        success: false,
        order_number: orderNumber,
        reason: err.message || "Failed",
        scanned,
        at: new Date(),
      };
      setResult(entry);
      setLog((prev) => [entry, ...prev].slice(0, 12));
      beep("error");
    } finally {
      setBusy(false);
      setPendingDecision(null);
      inputRef.current?.focus();
    }
  }

  function outcomeText(entry) {
    return describeScanOutcome({ renderSuccess, fieldLabel }, entry);
  }

  function pressScan() {
    if (isTouchDevice()) {
      setScannerOpen(true);
      return;
    }
    setPairingOpen(true);
    openPhoneScanner(deskId);
  }

  function closePairing() {
    setPairingOpen(false);
    closePhoneScanner(deskId);
  }

  const resultCard = result ? (
    <div
      className={`flex items-start gap-3 rounded-md border px-3 py-3 ${
        result.success
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      <span className="shrink-0">{result.success ? <CheckIcon /> : <CrossIcon />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{result.order_number}</p>
        {result.pending && pendingDecision ? (
          <div className="mt-1.5">
            <p className="text-xs">{decision.prompt}</p>
            <div className="mt-2 flex gap-2">
              {decision.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={busy}
                  onClick={() => resolveDecision(opt.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
                    opt.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs">{outcomeText(result)}</p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="h-fit rounded-lg border border-surface-border bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <button
          type="button"
          onClick={toggleMuted}
          title={muted ? "Sound off" : "Sound on"}
          aria-label={muted ? "Turn scan sound on" : "Turn scan sound off"}
          className={`shrink-0 rounded-md border p-1.5 transition ${
            muted
              ? "border-surface-border bg-white text-slate-400 hover:bg-surface"
              : "border-brand-200 bg-brand-50 text-brand-700"
          }`}
        >
          <SoundIcon muted={muted} />
        </button>
      </div>

      {showPairing ? (
        <PhoneScanPairing
          session={phone}
          onRetry={retryPhoneScanner}
          onClose={closePairing}
          onUseThisCamera={() => {
            closePairing();
            setScannerOpen(true);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={pressScan}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-brand-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-900"
        >
          <CameraIcon />
          Scan
        </button>
      )}
      {phoneElsewhere && !showPairing ? (
        <p className="mt-2 text-xs text-amber-700">
          Your phone is scanning for &ldquo;{SCAN_DESKS[phone.deskId]?.title}&rdquo;. Press Scan to switch it here.
        </p>
      ) : null}

      <p className="mt-2 text-[11px] text-slate-400">
        Or type the {fieldLabel.toLowerCase()} below, then press {actionLabel}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="mt-2 flex gap-2"
      >
        <input
          ref={inputRef}
          autoFocus={autoFocusInput}
          value={value}
          disabled={busy || Boolean(pendingDecision)}
          onKeyDown={() => {
            keyTimesRef.current = [...keyTimesRef.current, Date.now()].slice(-40);
          }}
          onChange={(e) => setValue(e.target.value)}
          placeholder={fieldLabel}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
        />
        <Button type="submit" disabled={!value.trim()} loading={busy}>
          {actionLabel}
        </Button>
      </form>

      {!scannerOpen && resultCard ? <div className="mt-4">{resultCard}</div> : null}

      {scannerOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-medium text-white">{title}</p>
            <button
              type="button"
              onClick={() => setScannerOpen(false)}
              aria-label="Close scanner"
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <CloseIcon />
            </button>
          </div>

          <CameraViewport id={cameraElementId} />

          <div className="space-y-3 bg-black px-4 py-4">
            <p className={`text-center text-sm ${camera.status === "error" ? "text-red-400" : "text-slate-300"}`}>
              {camera.status === "loading"
                ? "Opening camera…"
                : camera.status === "error"
                  ? camera.error
                  : busy || pendingDecision
                    ? "Processing — hold on before scanning the next parcel."
                    : `Point the camera at the ${fieldLabel.toLowerCase()} barcode.`}
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
            {resultCard}
          </div>
        </div>
      ) : null}

      {log.length > 0 ? (
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Recent scans
          </p>
          {log.map((entry, i) => (
            <div
              key={i}
              className={`flex items-baseline gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${
                entry.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
              }`}
            >
              <span className="font-medium">{entry.order_number}</span>
              <span className="min-w-0 truncate">
                {entry.success
                  ? renderSuccess?.(entry) || "Done"
                  : entry.reason === "not_found"
                    ? "No order with that number"
                    : entry.reason}
              </span>
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide opacity-60">
                {entry.scanned ? "Scanned" : "Typed"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
