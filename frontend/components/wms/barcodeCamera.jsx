"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
export function useBeeper(muted) {
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

/**
 * Runs the camera inside <CameraViewport id={elementId} /> while `open`,
 * decoding barcodes continuously and handing each to onDecode(text). Stops
 * the moment `open` goes false or the caller unmounts, so the camera light
 * doesn't stay on in the background.
 *
 * status: "idle" before opening, "loading" while the camera library loads
 * and permission is requested, "active" once frames are being decoded,
 * "error" on a denied/unavailable camera. retry() re-runs after a failure.
 */
export function useBarcodeCamera({ open, elementId, onDecode }) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  // Bumped by retry() - included in the effect's dependencies purely to force
  // it to re-run after a denied/failed permission prompt, since `open` is
  // already true and wouldn't otherwise change.
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount((n) => n + 1), []);
  const onDecodeRef = useRef(onDecode); // always the latest - the camera outlives renders
  onDecodeRef.current = onDecode;

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    let scanner = null;
    setStatus("loading");
    setError("");

    // Can fail rather than stop if the camera isn't running yet - closing while
    // it's still opening must not take the page down.
    function stopScanner() {
      try {
        scanner
          ?.stop()
          .then(() => scanner.clear())
          .catch(() => {});
      } catch {
        // Still opening - the .then after start() stops it instead.
      }
    }

    loadHtml5Qrcode()
      .then(async () => {
        if (cancelled) return;
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = window;
        const formats = Object.values(Html5QrcodeSupportedFormats || {}).filter(
          (v) => typeof v === "number"
        );
        const starting = new Html5Qrcode(elementId, {
          formatsToSupport: formats.length ? formats : undefined,
          verbose: false,
        });

        // {facingMode: "environment"} is only a hint, and real devices
        // (confirmed - it opened the front/selfie camera on a test
        // device) can silently ignore it rather than reject it, so
        // there's no error to react to, just the wrong camera. Naming an
        // actual camera id is authoritative instead. getCameras() itself
        // requests camera access (briefly opening and immediately
        // releasing a stream) to unlock real device labels before
        // enumerating, which is also what shows the permission prompt -
        // start() below then opens the specific device chosen here.
        let cameraTarget = { facingMode: "environment" };
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras && cameras.length > 0) {
            const rear = cameras.find((c) => /back|rear|environment/i.test(c.label));
            cameraTarget = (rear || cameras[cameras.length - 1]).id;
          }
        } catch {
          // Permission denied, or enumeration isn't supported here - the
          // facingMode hint above still gives start() something to try,
          // and start() itself will surface a real denial to the caller.
        }
        if (cancelled) return;

        scanner = starting;
        return starting.start(
          cameraTarget,
          {
            fps: 10,
            // A fixed {width, height} here is a fixed PIXEL size, not a
            // fraction of the video - on a real phone camera feed
            // (often 720p+) a flat 260x160 box reads as a tiny square
            // lost in a huge dark frame, which is exactly what looked
            // wrong. Sizing it off the actual viewfinder dimensions
            // (html5-qrcode calls this back with them) makes the box
            // fill most of the screen on any device instead.
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const width = Math.floor(viewfinderWidth * 0.85);
              const height = Math.floor(Math.min(viewfinderHeight * 0.45, width * 0.6));
              return { width, height };
            },
          },
          (decodedText) => onDecodeRef.current?.(decodedText),
          () => {} // fires on every frame with no code in view - not an error
        );
      })
      .then(() => {
        if (!cancelled) setStatus("active");
        // Closed while the camera was still opening: the stop in the cleanup
        // below came too early, and this is the moment it can actually work.
        else stopScanner();
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(
          err?.message?.includes("Permission")
            ? "Camera permission was denied - allow camera access and try again."
            : err?.message || "Could not open the camera."
        );
      });

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [open, elementId, retryCount]);

  return { status, error, retry };
}

export function CameraViewport({ id }) {
  return (
    <>
      <style>{`
        #${id} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>
      <div id={id} className="relative w-full flex-1 overflow-hidden bg-slate-900" />
    </>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-6 w-6">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-7 w-7">
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-7 w-7">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
