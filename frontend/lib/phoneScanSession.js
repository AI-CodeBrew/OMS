import { create } from "zustand";
import { connectScanSession } from "./scanSessionSocket";
import { describeScanOutcome, SCAN_DESKS } from "./scanDesks";
import wmsService from "../services/wmsService";
import useAuthStore from "../store/authStore";

// The laptop's side of phone scanning. Lives at module level rather than in
// ScanPanel because a paired phone only stops at its own cross: the laptop can
// close the panel, change page or refresh and the phone's scans keep running,
// through the same calls the panel makes, under the laptop's login and store.
//
// While the desk's panel is open the scan goes through it, so it shows in its
// log and refreshes its page; otherwise straight through lib/scanDesks.js.

// While no phone is connected and the QR code is on screen, it's replaced this
// often. The backend's token outlives this slightly - see core/scan_sessions.py.
const QR_REFRESH_MS = 60000;

// status: "idle", "starting", "waiting" (show the QR code), "paired" (a phone
// is connected), "away" (the paired phone dropped off and should come back),
// "reconnecting", or "error". deskId: what the phone is scanning for.
// returnRecordedAt: when the phone last received a return, for the Returns page
// to refresh on.
const INITIAL_STATE = { status: "idle", phoneUrl: "", error: "", deskId: null, returnRecordedAt: 0 };
export const usePhoneScanStore = create(() => INITIAL_STATE);
const getState = usePhoneScanStore.getState;
const update = usePhoneScanStore.setState;

let session = null;
let hostToken = null;
let run = 0; // bumped on every start/stop, so a stale connection's events are dropped
let pairingDeskId = null; // the panel showing the QR code, if any
let claim = null; // { deskId, handler } for the open panel
let refreshTimer = null;
const phones = new Set();

// Remembered so a page refresh can pick the phone back up. sessionStorage, so
// it's per browser tab: with localStorage, a second tab would host the same
// session and every scan would run twice. Keyed by user so nobody who logs in
// next inherits the phone under their own login.
function savedKey() {
  const userId = useAuthStore.getState().user?.id;
  return userId ? `oms.phoneScan.${userId}` : null;
}

function readSaved() {
  try {
    const key = savedKey();
    const raw = key && window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // Blocked storage - a refresh just means a new QR code.
  }
}

function writeSaved(value) {
  try {
    const key = savedKey();
    if (!key) return;
    if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else window.sessionStorage.removeItem(key);
  } catch {
    // As above.
  }
}

function stopRefresh() {
  clearTimeout(refreshTimer);
}

function requestQr() {
  session?.send({ type: "new_qr" });
}

function sayHello() {
  const desk = SCAN_DESKS[getState().deskId];
  session?.send({ type: "hello", title: desk?.title || "", field: desk?.fieldLabel || "" });
}

function idleStatus() {
  return readSaved() ? "away" : "waiting";
}

// Pressed Scan just now, or this desk's panel is open with its phone away
// (ScanPanel shows the code then too, for switching to a different phone).
function qrOnScreen() {
  return Boolean(pairingDeskId || (claim?.deskId === getState().deskId && readSaved()));
}

// A hidden tab's timers can run late, so the code could already be stale when
// someone comes back to it.
function onVisibilityChange() {
  if (document.visibilityState === "visible" && qrOnScreen() && phones.size === 0) requestQr();
}

function noteOnPanel(deskId, entry) {
  if (claim?.deskId === deskId) claim.note?.(entry);
}

async function runDetached(code) {
  const desk = SCAN_DESKS[getState().deskId];
  if (!desk) return { status: "fail", order_number: code, message: "Press Scan on the laptop first." };
  const response = await desk.onScan(code);
  const entry = { ...response, order_number: response.order_number || code };
  // Found, but only counted once the phone has shown its Good/Damaged/Lost form.
  if (entry.success && desk.phoneCount) {
    return { status: "count", order_number: entry.order_number, lines: entry.lines || [] };
  }
  noteOnPanel(desk.deskId, entry);
  return {
    status: entry.success ? "ok" : "fail",
    order_number: entry.order_number,
    message: describeScanOutcome(desk, entry),
  };
}

async function handleScan(frame) {
  const sentFrom = session;
  const desk = SCAN_DESKS[getState().deskId];
  // A desk the phone counts on stays off its panel, whose own flow would open
  // the count popup on the laptop as well.
  const throughPanel = claim && claim.deskId === desk?.deskId && !desk.phoneCount;
  let outcome;
  try {
    outcome = throughPanel ? await claim.handler(frame.code) : await runDetached(frame.code);
  } catch (err) {
    outcome = { status: "fail", order_number: frame.code, message: err.message || "Scan failed" };
  }
  if (session === sentFrom) session?.send({ type: "result", id: frame.id, ...outcome });
}

// The phone's Confirm on a count. Always the Returns desk, even if the laptop
// has since pointed the phone at another one - this parcel is already counted.
async function handleCount(frame) {
  const sentFrom = session;
  const desk = SCAN_DESKS.returns;
  let outcome;
  try {
    const response = await desk.phoneCount.receive(frame.order_number, frame.breakdown);
    const entry = { ...response, order_number: response.order_number || frame.order_number };
    noteOnPanel(desk.deskId, entry);
    if (entry.success) update({ returnRecordedAt: Date.now() });
    outcome = {
      status: entry.success ? "ok" : "fail",
      order_number: entry.order_number,
      message: describeScanOutcome(desk, entry),
    };
  } catch (err) {
    outcome = { status: "fail", order_number: frame.order_number, message: err.message || "Receive failed" };
  }
  if (session === sentFrom) session?.send({ type: "result", id: frame.id, ...outcome });
}

function handleFrame(frame) {
  if (frame.type === "qr") {
    // The token sits after the # so it never reaches a server log.
    update({ phoneUrl: `${window.location.origin}/scan#${frame.token}` });
    stopRefresh();
    if (qrOnScreen() && phones.size === 0) refreshTimer = setTimeout(requestQr, QR_REFRESH_MS);
  } else if (frame.type === "phone_joined") {
    phones.add(frame.peer);
    writeSaved({ token: hostToken, deskId: getState().deskId });
    stopRefresh();
    update({ status: "paired" });
    sayHello();
  } else if (frame.type === "phone_left") {
    phones.delete(frame.peer);
    if (phones.size > 0) return;
    update({ status: idleStatus() });
    if (qrOnScreen()) requestQr();
  } else if (frame.type === "phone_ended") {
    // The cross - the one thing that actually ends this, and it ends all of
    // it. Counting only the phone that pressed it left the laptop stuck on
    // "Phone connected" whenever another scanner tab or a dropped connection
    // still counted as a phone, with no QR code to get out of it.
    session?.send({ type: "ended" });
    writeSaved(null);
    const deskId = pairingDeskId;
    stop();
    if (deskId) openPhoneScanner(deskId);
  } else if (frame.type === "scan") {
    handleScan(frame);
  } else if (frame.type === "count") {
    handleCount(frame);
  }
}

function start(savedToken) {
  run += 1;
  const thisRun = run;
  const whileCurrent =
    (fn) =>
    (...args) => {
      if (thisRun === run) fn(...args);
    };

  update({ status: "starting", phoneUrl: "", error: "" });
  document.addEventListener("visibilitychange", onVisibilityChange);

  (savedToken ? Promise.resolve({ host_token: savedToken }) : wmsService.createScanSession())
    .then(
      whileCurrent(({ host_token: token }) => {
        hostToken = token;
        session = connectScanSession(token, {
          onOpen: whileCurrent(() => {
            // A phone that stayed connected answers host_joined with "here".
            phones.clear();
            update({ status: idleStatus() });
          }),
          onFrame: whileCurrent(handleFrame),
          onDown: whileCurrent(() => {
            stopRefresh();
            update({ status: "reconnecting" });
          }),
          onRejected: whileCurrent(() => {
            stopRefresh();
            writeSaved(null); // Try again starts a fresh session.
            update({ status: "error", error: "This scan session has expired." });
          }),
        });
      })
    )
    .catch(
      whileCurrent((err) => {
        update({ status: "error", error: err.message || "Could not start phone scanning." });
      })
    );
}

function stop() {
  run += 1;
  stopRefresh();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  session?.close();
  session = null;
  hostToken = null;
  phones.clear();
  pairingDeskId = null;
  update(INITIAL_STATE);
}

// Scan pressed on a panel: show its QR code or, with a phone already paired,
// point that phone at this desk.
export function openPhoneScanner(deskId) {
  pairingDeskId = deskId;
  update({ deskId });
  if (readSaved()) writeSaved({ ...readSaved(), deskId });

  const { status } = getState();
  if (status === "idle" || status === "error") {
    start(readSaved()?.token);
  } else if (phones.size === 0) {
    requestQr();
  } else {
    sayHello();
  }
}

// The panel's QR code is going away. With no phone ever paired there's nothing
// left to keep; a paired phone carries on regardless.
export function closePhoneScanner(deskId) {
  if (pairingDeskId !== deskId) return;
  pairingDeskId = null;
  stopRefresh();
  if (phones.size === 0 && !readSaved()) stop();
}

export function retryPhoneScanner() {
  const deskId = pairingDeskId;
  stop();
  if (deskId) openPhoneScanner(deskId);
}

// A panel taking its desk's scans while it's open, so they run its full flow.
// note(entry) adds to its log a result that didn't go through that flow.
// Returns the call to make when it closes.
export function claimPhoneDesk(deskId, handler, note) {
  const mine = { deskId, handler, note };
  claim = mine;
  if (qrOnScreen() && phones.size === 0) requestQr();
  return () => {
    if (claim === mine) claim = null;
    closePhoneScanner(deskId);
    if (!qrOnScreen()) stopRefresh();
  };
}

// On page load - picks a paired phone back up after a refresh, on any page.
export function resumePhoneScanner() {
  const saved = readSaved();
  if (getState().status !== "idle" || !saved) return;
  update({ deskId: saved.deskId });
  start(saved.token);
}

// Logged out or another user in: their phone must not run under this login.
// The saved session stays, under its own user, for if they log back in.
useAuthStore.subscribe((next, previous) => {
  if (next.user?.id !== previous.user?.id && getState().status !== "idle") stop();
});
