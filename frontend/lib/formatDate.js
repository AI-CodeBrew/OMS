// Every date the app shows: dd/mm/yyyy, and dd/mm/yyyy, hh:mm AM/PM with a
// time - the same on every computer, whatever its own date settings (a
// US-set Windows would otherwise show mm/dd/yyyy). Inputs take an ISO
// string, a Date, or a timestamp; blank/invalid -> "" (callers add their
// own "—" / "Never").

function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n) => String(n).padStart(2, "0");

/** dd/mm/yyyy */
export function formatDate(value) {
  const d = toDate(value);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : "";
}

/** hh:mm AM/PM */
export function formatTime(value) {
  const d = toDate(value);
  if (!d) return "";
  const hours = d.getHours();
  return `${pad(hours % 12 || 12)}:${pad(d.getMinutes())} ${hours < 12 ? "AM" : "PM"}`;
}

/** dd/mm/yyyy, hh:mm AM/PM */
export function formatDateTime(value) {
  const d = toDate(value);
  return d ? `${formatDate(d)}, ${formatTime(d)}` : "";
}
