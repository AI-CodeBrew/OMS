import ordersService from "../services/ordersService";
import wmsService from "../services/wmsService";

// Everything that defines each place a parcel gets scanned, in one spot and
// free of any page, because a paired phone keeps scanning for its desk after
// that desk's panel has been closed or the laptop's page refreshed
// (lib/phoneScanSession.js). ScanPanel takes these same values as its props.
//
// detachedMessage marks a desk whose scan needs its panel on the laptop: the
// phone is told this instead of the scan running.
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
  // Each parcel is counted in a popup on the Returns page, so there's nothing
  // useful a scan can do without it. The page supplies its own onScan.
  returns: {
    deskId: "returns",
    title: "Scan returned parcel",
    hint: "Scanning only finds the parcel - nothing is recorded until you confirm its count in the popup.",
    actionLabel: "Check",
    fieldLabel: "Tracking number",
    renderSuccess: () => "Found — count the items in the popup",
    detachedMessage: "Not recorded. Open Scan on the laptop's Returns page to count this parcel.",
  },
};

export function describeScanOutcome({ renderSuccess, fieldLabel }, entry) {
  if (entry.success) return renderSuccess?.(entry) || "Done";
  if (entry.reason === "not_found") return `No matching order for that ${fieldLabel.toLowerCase()}`;
  return entry.reason;
}
