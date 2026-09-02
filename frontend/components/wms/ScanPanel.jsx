"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Button from "../shared/Button";

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

// Loaded from a CDN rather than an npm dependency - staff scan from
// whatever phone they have (Android Chrome, iPhone Safari, ...), and this
// library's pure-JS barcode decoder runs identically on all of them,
// unlike the browser's native BarcodeDetector API which Safari doesn't
// implement at all. Cached at module scope so navigating between Returns
// and Packing (each with their own ScanPanel) only fetches it once.
const HTML5_QRCODE_SRC = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
let html5QrcodeLoadPromise = null;

function loadHtml5Qrcode() {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.Html5Qrcode) return Promise.resolve();
  if (html5QrcodeLoadPromise) return html5QrcodeLoadPromise;

  html5QrcodeLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${HTML5_QRCODE_SRC}"]`);
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load the camera library")), {
      once: true,
    });
    if (!existing) {
      script.src = HTML5_QRCODE_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((err) => {
    html5QrcodeLoadPromise = null; // let a retry try fetching again
    throw err;
  });
  return html5QrcodeLoadPromise;
}

/**
 * Plays a short tone without any audio asset. Created lazily on the first
 * scan (a user gesture, so autoplay policy is satisfied) and reused after
 * that. Every call is best-effort: a browser with audio blocked or
 * unavailable must still scan normally.
 */
function useBeeper(muted) {
  const contextRef = useRef(null);

  return useCallback(
    (kind) => {
      if (muted) return;
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        if (!contextRef.current) contextRef.current = new Ctor();
        const ctx = contextRef.current;
        if (ctx.state === "suspended") ctx.resume();

        // Success: a quick rising two-tone chirp. Failure: one lower,
        // longer buzz - deliberately unlike the success sound so they
        // can't be confused across a noisy warehouse.
        const notes =
          kind === "success"
            ? [
                { freq: 880, start: 0, duration: 0.09 },
                { freq: 1320, start: 0.1, duration: 0.12 },
              ]
            : [{ freq: 180, start: 0, duration: 0.42 }];

        notes.forEach(({ freq, start, duration }) => {
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = kind === "success" ? "sine" : "square";
          oscillator.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(ctx.currentTime + start);
          oscillator.stop(ctx.currentTime + start + duration + 0.02);
        });
      } catch {
        // Audio is a convenience - never let it break the scan itself.
      }
    },
    [muted]
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-7 w-7">
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-7 w-7">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-6 w-6">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Barcode station shared by the Returns Desk and the Packing bench.
 *
 * onScan(code) must resolve to the {success, order_number, reason} shape
 * the wms scan endpoints return; whatever it resolves to is handed
 * straight to renderSuccess for the detail line. `code` is a tracking
 * number (what's actually printed as a barcode on a parcel's courier
 * label) - see fieldLabel below.
 */
export default function ScanPanel({
  title,
  hint,
  actionLabel = "Submit",
  fieldLabel = "Order number",
  onScan,
  renderSuccess,
  onAfterSuccess,
  decision,
}) {
  // The camera only ever opens from an explicit tap on the Scan button
  // below - never on mount/default, so landing on the page doesn't throw
  // an unexpected camera-permission prompt at anyone.
  const [scannerOpen, setScannerOpen] = useState(false);
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
  // "idle" before the scanner is opened, "loading" while the camera
  // library loads and permission is requested, "active" once frames are
  // being decoded, "error" on a denied/unavailable camera.
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [cameraError, setCameraError] = useState("");
  // Bumped by the Try Again button - included in the camera effect's
  // dependencies purely to force it to re-run after a denied/failed
  // permission prompt, since scannerOpen is already true and wouldn't
  // otherwise change.
  const [cameraRetryCount, setCameraRetryCount] = useState(0);

  const inputRef = useRef(null);
  const keyTimesRef = useRef([]);
  const lastSubmitRef = useRef({ code: "", at: 0 });
  const scannerRef = useRef(null);
  const submitRef = useRef(null); // always points at the latest submit() - see camera effect below
  // Colons stripped - safe for both getElementById and any internal
  // querySelector the camera library might use, React's default useId()
  // format includes them.
  const cameraElementId = `scan-camera-${useId().replace(/:/g, "")}`;
  const beep = useBeeper(muted);

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

  // Opens the phone/webcam camera the moment the operator taps Scan, and
  // decodes barcodes continuously - every successful decode is handed to
  // submit() exactly like a hardware scanner's keystrokes were before, so
  // the rest of the flow (duplicate guard, beep, decision prompt, log) is
  // unchanged. Stops the moment the overlay is closed or the panel
  // unmounts, so the camera light doesn't stay on in the background.
  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;
    setCameraStatus("loading");
    setCameraError("");

    loadHtml5Qrcode()
      .then(() => {
        if (cancelled) return;
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = window;
        const formats = Object.values(Html5QrcodeSupportedFormats || {}).filter(
          (v) => typeof v === "number"
        );
        const scanner = new Html5Qrcode(cameraElementId, {
          formatsToSupport: formats.length ? formats : undefined,
          verbose: false,
        });
        scannerRef.current = scanner;
        return scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 160 } },
          (decodedText) => submitRef.current?.(decodedText, { forceScanned: true }),
          () => {} // fires on every frame with no code in view - not an error
        );
      })
      .then(() => {
        if (!cancelled) setCameraStatus("active");
      })
      .catch((err) => {
        if (cancelled) return;
        setCameraStatus("error");
        setCameraError(
          err?.message?.includes("Permission")
            ? "Camera permission was denied - allow camera access and try again."
            : err?.message || "Could not open the camera."
        );
      });

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
  }, [scannerOpen, cameraElementId, cameraRetryCount]);

  function wasScanned() {
    const times = keyTimesRef.current;
    if (times.length < MIN_CODE_LENGTH) return false;
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    return gaps.every((gap) => gap < SCANNER_KEY_INTERVAL_MS);
  }

  async function submit(raw, { forceScanned } = {}) {
    // The current parcel's decision must be resolved before the next one
    // can be scanned - otherwise a Good/Bad click could land on the wrong
    // parcel. The busy guard matters here specifically for the camera,
    // which keeps decoding frames continuously - without it, holding a
    // barcode in view a moment too long would fire a second submit while
    // the first is still in flight.
    if (pendingDecision || busy) return;

    const code = (raw || "").trim();
    // Camera detections have no keystrokes to time - they're always a
    // real scan, never "typed".
    const scanned = forceScanned !== undefined ? forceScanned : wasScanned();

    if (code.length < MIN_CODE_LENGTH) {
      // A half-read barcode or a stray Enter - clear and wait rather than
      // firing a request that can only fail.
      setValue("");
      keyTimesRef.current = [];
      return;
    }

    const now = Date.now();
    if (code === lastSubmitRef.current.code && now - lastSubmitRef.current.at < DUPLICATE_WINDOW_MS) {
      setValue("");
      keyTimesRef.current = [];
      return;
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
        setResult({ ...response, order_number: orderNumber, scanned, at: new Date(), pending: true });
        setPendingDecision({ orderNumber, scanned });
        beep("success");
        return;
      }

      const entry = { ...response, order_number: orderNumber, scanned, at: new Date() };
      setResult(entry);
      setLog((prev) => [entry, ...prev].slice(0, 12));
      beep(entry.success ? "success" : "error");
      if (entry.success) await onAfterSuccess?.();
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
    } finally {
      setBusy(false);
      setValue("");
      keyTimesRef.current = [];
      inputRef.current?.focus();
    }
  }
  submitRef.current = submit;

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

  const notFoundText = `No matching order for that ${fieldLabel.toLowerCase()}`;

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
          <p className="text-xs">
            {result.success ? renderSuccess?.(result) || "Done" : result.reason === "not_found" ? notFoundText : result.reason}
          </p>
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

      <button
        type="button"
        onClick={() => setScannerOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-brand-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-900"
      >
        <CameraIcon />
        Scan
      </button>

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
          value={value}
          disabled={busy || Boolean(pendingDecision)}
          onKeyDown={() => {
            keyTimesRef.current = [...keyTimesRef.current, Date.now()].slice(-40);
          }}
          onChange={(e) => setValue(e.target.value)}
          placeholder={fieldLabel}
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
        />
        <Button type="submit" disabled={busy || !value.trim()}>
          {busy ? "…" : actionLabel}
        </Button>
      </form>

      {!scannerOpen && resultCard ? <div className="mt-4">{resultCard}</div> : null}

      {scannerOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <style>{`
            #${cameraElementId} video {
              width: 100% !important;
              height: 100% !important;
              object-fit: cover !important;
            }
          `}</style>

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

          <div id={cameraElementId} className="relative w-full flex-1 overflow-hidden bg-slate-900" />

          <div className="space-y-3 bg-black px-4 py-4">
            <p className={`text-center text-sm ${cameraStatus === "error" ? "text-red-400" : "text-slate-300"}`}>
              {cameraStatus === "loading"
                ? "Opening camera…"
                : cameraStatus === "error"
                  ? cameraError
                  : busy || pendingDecision
                    ? "Processing — hold on before scanning the next parcel."
                    : `Point the camera at the ${fieldLabel.toLowerCase()} barcode.`}
              {cameraStatus === "error" ? (
                <button
                  type="button"
                  onClick={() => setCameraRetryCount((n) => n + 1)}
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
