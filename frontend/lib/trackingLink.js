// The courier's own tracking page for a tracking number - what a clickable
// tracking ID opens. One entry per courier, matched on the courier's name
// reduced to letters ("Barq Raftar", "BarqRaftar" -> "barqraftar").

const COURIERS = {
  barqraftar: { label: "BarqRaftar", url: (t) => `https://barqraftar.pk/track?tracking_number=${t}` },
  // No tracking-number parameter on this page - it opens and the number is
  // copied, ready to paste (same as Tranzo).
  leopards: { label: "Leopards", url: () => "https://pk.leopardscourier.com/tracking", copy: true },
  postex: { label: "PostEx", url: (t) => `https://postex.pk/tracking?cn=${t}` },
  trax: { label: "Trax", url: (t) => `https://trax.pk/tracking/${t}` },
  tcs: { label: "TCS", url: (t) => `https://www.tcsexpress.com/track/${t}` },
  // Tranzo's page has no tracking-number parameter either.
  tranzo: { label: "Tranzo", url: () => "https://tranzo.pk/track-order", copy: true },
  dex: { label: "DEX", url: (t) => `https://www.dex.com.pk/tracking?references=${t}` },
};

function courierKey(name) {
  const letters = (name || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return "";
  if (letters.startsWith("barq") || letters.startsWith("burq")) return "barqraftar";
  if (letters.startsWith("leopard")) return "leopards";
  if (letters.startsWith("postex")) return "postex";
  if (letters.startsWith("trax")) return "trax";
  if (letters.startsWith("tcs")) return "tcs";
  if (letters.startsWith("tranzo")) return "tranzo";
  if (letters === "dex" || letters.startsWith("dexcourier") || letters.startsWith("dexpress")) return "dex";
  if (letters.startsWith("smartlane")) return "smartlane";
  return "";
}

// Smartlane books through other couriers and keeps their tracking numbers;
// the number's shape tells which one it went with.
function carrierFromNumber(tracking) {
  const t = (tracking || "").trim().toUpperCase();
  if (/^[A-Z]{3}\d{9,}$/.test(t)) return "barqraftar"; // ISL338172609815, LHR...
  if (/^[A-Z]{2}\d{8,}$/.test(t)) return "leopards"; // LE7545273139, KI...
  if (/^\d{14}$/.test(t)) return "trax"; // 22322366840505
  return "";
}

/** {url, label, copy} for a courier + tracking number, or null when the
 * courier has no known tracking page. */
export function trackingLink(courierName, trackingNumber) {
  const tracking = (trackingNumber || "").trim();
  if (!tracking) return null;
  let key = courierKey(courierName);
  if (key === "smartlane") key = carrierFromNumber(tracking);
  const courier = COURIERS[key];
  if (!courier) return null;
  return { url: courier.url(encodeURIComponent(tracking)), label: courier.label, copy: Boolean(courier.copy) };
}
