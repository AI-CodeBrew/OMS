// Display-only formatting for Pakistani phone numbers - customer_phone is
// stored exactly as received (Shopify webhook payload or manual entry),
// so "+92..." and "0..." both show up depending on the source. This just
// normalizes how it's *shown* in the Orders table; nothing is rewritten
// in the database.
export function formatPakPhone(phone) {
  if (!phone) return phone;
  if (phone.startsWith("+92")) return `0${phone.slice(3)}`;
  if (/^92\d{10}$/.test(phone)) return `0${phone.slice(2)}`;
  // Bare 10-digit mobile number with the leading 0 missing entirely (e.g.
  // "3057258866" instead of "03057258866") - some sources drop it rather
  // than using +92 or a 92-prefixed form.
  if (/^3\d{9}$/.test(phone)) return `0${phone}`;
  return phone;
}

export default formatPakPhone;
