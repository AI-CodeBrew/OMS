// Compact relative timestamps for dense ticket lists ("2h ago" instead of
// a full locale string) - callers that need the exact time put it in a
// title attribute alongside this, they don't replace one with the other.
const UNITS = [
  { limit: 60, divisor: 1, unit: "s" },
  { limit: 3600, divisor: 60, unit: "m" },
  { limit: 86400, divisor: 3600, unit: "h" },
  { limit: 604800, divisor: 86400, unit: "d" },
  { limit: 2629800, divisor: 604800, unit: "w" },
];

export function timeAgo(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);

  if (seconds < 10) return "just now";
  for (const { limit, divisor, unit } of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${unit} ago`;
  }
  // Beyond ~a month, a relative count stops being useful - fall back to a
  // short absolute date.
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default timeAgo;
