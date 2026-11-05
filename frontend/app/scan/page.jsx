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
import { connectScanSession } from "../../lib/scanSessionSocket";

const CAMERA_ELEMENT_ID = "phone-scan-camera";
const MIN_CODE_LENGTH = 3;
// The camera re-reads a barcode on every frame it's in view, so the same code
// only counts again once it has been out of view this long - holding a parcel
// still must not send it twice.
const SAME_CODE_GAP_MS = 2000;
// Longer than the laptop's own API timeout, so this only fires when the
// laptop really isn't answering.
const REPLY_TIMEOUT_MS = 35000;

// The phone's end of the laptop's Scan panel, opened from its QR code - no
// login here on purpose. This page only reads barcodes and passes them to the
// laptop, which runs its normal scan flow and sends back the outcome, whatever
// else it's doing (lib/phoneScanSession.js). The token after the # is the link
// to that one laptop's browser tab, and only the cross here ends it.
export default function PhoneScanPage() {
  const [token, setToken] = useState(null);
  const [started, setStarted] = useState(false);
  // The operator pressed the cross - the only thing that ends this session.
  const [closed, setClosed] = useState(false);
  // "connecting", "waiting" (no laptop on the session), "ready", or "expired".
  const [link, setLink] = useState("connecting");
  const [desk, setDesk] = useState({ title: "", field: "" });
  const [card, setCard] = useState(null);

  const beep = useBeeper(false);
  const sessionRef = useRef(null);
  const linkRef = useRef(link);
  linkRef.current = link;
  const pendingRef = useRef(null); // { id, timer } for the scan awaiting its reply
  const lastCodeRef = useRef({ code: "", at: 0 });

  useEffect(() => {
    setToken(window.location.hash.slice(1));
  }, []);

  function vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Not every phone can - iPhones don't.
    }
  }

  function clearPending() {
    if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
  }

  function handleResult(frame) {
    if (frame.id !== pendingRef.current?.id) return;
    clearPending();
    if (frame.status === "ignored") {
      setCard(frame.message ? { tone: "info", message: frame.message } : null);
      return;
    }
    const success = frame.status === "ok";
    setCard({
      tone: success ? "success" : "error",
      title: frame.order_number,
      message: frame.message,
    });
    beep(success ? "success" : "error");
    vibrate(success ? 80 : [200, 80, 200]);
  }

  const handleResultRef = useRef(handleResult);
  handleResultRef.current = handleResult;

  useEffect(() => {
    if (!token || closed) return undefined;

    const session = connectScanSession(token, {
      onOpen: () => setLink("waiting"),
      onFrame: (frame) => {
        if (frame.type === "session") {
          // The QR code's token only lasts a minute or so. Reconnects, and a
          // reload of this page, need the lasting one from here on.
          sessionRef.current?.setToken(frame.token);
          window.history.replaceState(null, "", `#${frame.token}`);
        } else if (frame.type === "hello") {
          setLink("ready");
          setDesk({ title: frame.title, field: frame.field });
        } else if (frame.type === "host_joined") {
          // The laptop is back - it needs to hear we're still here.
          sessionRef.current?.send({ type: "here" });
        } else if (frame.type === "host_left") {
          setLink("waiting");
          // A refreshing laptop's old connection can report leaving after its
          // new one has already joined - if so, this gets a hello straight back.
          sessionRef.current?.send({ type: "here" });
        } else if (frame.type === "result") {
          handleResultRef.current(frame);
        }
      },
      onDown: () => setLink("connecting"),
      onRejected: () => setLink("expired"),
    });
    sessionRef.current = session;

    return () => {
      sessionRef.current = null;
      session.close();
    };
  }, [token, closed]);

  useEffect(
    () => () => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    },
    []
  );

  // Ends the session for good: tells the laptop, and drops this phone's token
  // from the address bar so not even a reload can bring it back.
  function closeScanner() {
    sessionRef.current?.send({ type: "end" });
    clearPending();
    window.history.replaceState(null, "", window.location.pathname);
    setCard(null);
    setStarted(false);
    setClosed(true);
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
    if (pendingRef.current || linkRef.current !== "ready") return;

    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    if (!sessionRef.current?.send({ type: "scan", id, code })) return;

    lastCodeRef.current = { code, at: now };
    pendingRef.current = {
      id,
      timer: setTimeout(() => {
        pendingRef.current = null;
        setCard({
          tone: "error",
          title: code,
          message: "No reply from the laptop. Check it there before scanning this parcel again.",
        });
        beep("error");
      }, REPLY_TIMEOUT_MS),
    };
    setCard({ tone: "info", title: code, message: "Checking…" });
  }

  const camera = useBarcodeCamera({
    open: started && link !== "expired",
    elementId: CAMERA_ELEMENT_ID,
    onDecode: handleDecode,
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

  if (token === "" || link === "expired") {
    return (
      <PhoneMessage>
        {token === "" ? "This link is incomplete." : "This QR code has expired."} Press Scan on the
        laptop and scan the code showing there now.
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

  const linkMessage =
    link === "connecting"
      ? "Connecting…"
      : link === "waiting"
        ? "Waiting for the laptop - open the system there in the same browser tab. No new QR code needed."
        : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-medium text-white">{desk.title || "Phone scanner"}</p>
        <button
          type="button"
          onClick={closeScanner}
          aria-label="Close scanner"
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <CloseIcon />
        </button>
      </div>

      <CameraViewport id={CAMERA_ELEMENT_ID} />

      <div className="space-y-3 bg-black px-4 py-4">
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
      </div>
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
