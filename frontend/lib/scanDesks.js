import ordersService from "../services/ordersService";
import wmsService from "../services/wmsService";

// "3 good · 1 damaged · 1 lost" - a received parcel's count.
function breakdownText(breakdown) {
  if (!breakdown?.length) return "";
  const t = breakdown.reduce(
    (acc, l) => ({ good: acc.good + l.good, damaged: acc.damaged + l.damaged, lost: acc.lost + l.lost }),
    { good: 0, damaged: 0, lost: 0 }
  );
  return [
    `${t.good} good`,
    t.damaged ? `${t.damaged} damaged` : "",
    t.lost ? `${t.lost} lost` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function describeReturnOutcome(entry) {
  const restocked = entry.restocked || [];
  const missed = entry.not_restocked || [];
  const parts = restocked.map((r) => `${r.sku || r.product_name} +${r.quantity}`);
  // Lines with no stock item to put back on (no SKU, no unique name match).
  if (missed.length) parts.push(`not in inventory: ${missed.join(", ")}`);
  const counted = breakdownText(entry.breakdown);
  const stock = parts.length ? `restocked ${parts.join("; ")}` : "nothing restocked";
  return `Received${counted ? ` (${counted})` : ""} — ${stock}`;
}

// Everything that defines each place a parcel gets scanned, in one spot and
// free of any page, because a paired phone keeps scanning for its desk after
// that desk's panel has been closed or the laptop's page refreshed
// (lib/phoneScanSession.js). ScanPanel takes these same values as its props.
//
// phoneCount marks a desk where a found parcel still needs counting: a phone
// scan opens that count on the phone, and receive() records it.
export const SCAN_DESKS = {
  pack: {
    deskId: "pack",
    title: "Scan to pack",
    hint: "Scan the barcode on the airway bill (or type the tracking or order number). Only orders in Assigning Courier with a tracking number can be packed; a repeat scan is ignored.",
    actionLabel: "Mark Packed",
    fieldLabel: "Tracking or order number",
    onScan: (code) => ordersService.scanPack({ code }),
    renderSuccess: () => "Packed",
  },
  packed: {
    deskId: "packed",
    title: "Scan packed parcel",
    hint: "Only orders sitting in Ready to Pick can be packed. A repeat scan of the same parcel is ignored.",
    actionLabel: "Mark Packed",
    fieldLabel: "Tracking number",
    onScan: (trackingNumber) => wmsService.scanPacked({ trackingNumber }),
    renderSuccess: () => "Packed — moved to Awaiting Dispatched",
  },
  dispatch: {
    deskId: "dispatch",
    title: "Scan to dispatch",
    hint: "Scan or type each order number. Only orders Awaiting Dispatched can be dispatched.",
    actionLabel: "Confirm",
    fieldLabel: "Order number",
    onScan: (orderNumber) => ordersService.scanDispatch({ orderNumber }),
    renderSuccess: () => "Dispatched",
  },
  // The Returns page swaps onScan for one that opens the count popup there.
  returns: {
    deskId: "returns",
    title: "Scan returned parcel",
    hint: "Scanning only finds the parcel - nothing is recorded until you confirm its count in the popup.",
    actionLabel: "Check",
    fieldLabel: "Tracking number",
    onScan: (trackingNumber) => wmsService.lookupReturn({ trackingNumber }),
    renderSuccess: (entry) =>
      entry.restocked ? describeReturnOutcome(entry) : "Found — count the items in the popup",
    phoneCount: {
      receive: (orderNumber, breakdown) => wmsService.scanReturn({ orderNumber, breakdown }),
    },
  },
};

export function describeScanOutcome({ renderSuccess, fieldLabel }, entry) {
  if (entry.success) return renderSuccess?.(entry) || "Done";
  if (entry.reason === "not_found") return `No matching order for that ${fieldLabel.toLowerCase()}`;
  return entry.reason;
}
