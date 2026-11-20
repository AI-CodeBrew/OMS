"use client";

import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";

// Quiet zone around the code, in modules - the QR spec's minimum, and what
// phone cameras need to find the code against a busy screen.
const QUIET_ZONE = 4;

function QrCode({ text }) {
  const [matrix, setMatrix] = useState(null);

  useEffect(() => {
    // Type 0 picks the smallest size that fits; "M" survives a little
    // screen glare without making the code too dense to read from a laptop.
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    setMatrix({ path, viewBox: size + QUIET_ZONE * 2 });
  }, [text]);

  if (!matrix) return <div className="h-56 w-56" />;

  return (
    <svg
      viewBox={`0 0 ${matrix.viewBox} ${matrix.viewBox}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code to open the scanner on your phone"
      className="h-56 w-56 bg-white"
    >
      <path d={matrix.path} fill="#000" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 shrink-0">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" strokeLinecap="round" />
    </svg>
  );
}

// What the laptop shows after Scan: the QR code until a phone connects, then
// a status line. `session` is the state from lib/phoneScanSession.js.
// A phone on the session carries on until its own ✕ or this laptop's "End
// phone scanning" (onEnd) - user, 2026-11-20.
export default function PhoneScanPairing({ session, onRetry, onClose, onEnd, onUseThisCamera }) {
  const { status, phoneUrl, error, hadPhone } = session;
  const phoneIsPaired = status === "paired" || status === "away" || (status === "reconnecting" && hadPhone);

  let body;
  if (status === "error") {
    body = (
      <p className="text-sm text-red-600">
        {error}{" "}
        <button type="button" onClick={onRetry} className="font-medium underline">
          Try again
        </button>
      </p>
    );
  } else if (status === "paired") {
    body = (
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-green-700">
          <PhoneIcon />
          Phone connected - scan parcels with the phone.
        </div>
        <p className="mt-1 text-xs text-slate-500">
          It keeps working if you close this or move to another page. To stop, press End below or the ✕ on the phone.
        </p>
      </div>
    );
  } else if (phoneIsPaired) {
    body = (
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
          <PhoneIcon />
          {status === "reconnecting" ? "Reconnecting to the scan service…" : "Phone not connected right now."}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          It reconnects by itself when the phone&apos;s screen is on - no new QR code needed. To use a different
          phone, press End, then Scan again.
        </p>
      </div>
    );
  } else if (status === "waiting" && phoneUrl) {
    body = (
      <div className="flex flex-col items-center gap-2">
        <QrCode text={phoneUrl} />
        <p className="text-center text-xs text-slate-500">
          Scan this code with your phone&apos;s camera to open the scanner there. A new code appears every minute.
        </p>
      </div>
    );
  } else {
    body = (
      <p className="text-sm text-slate-500">
        {status === "reconnecting" ? "Reconnecting - a new QR code will show in a moment…" : "Preparing QR code…"}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-surface-border bg-surface p-3">
      {body}
      {phoneIsPaired ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onEnd}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            ✕ End phone scanning
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={onUseThisCamera}
            className="text-slate-500 underline hover:text-slate-700"
          >
            Use this device&apos;s camera
          </button>
          <button type="button" onClick={onClose} className="font-medium text-slate-700 hover:text-slate-900">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
