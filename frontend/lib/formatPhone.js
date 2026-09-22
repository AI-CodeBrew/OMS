// Display-only formatting for Pakistani phone numbers - customer_phone is
// stored exactly as received (Shopify webhook payload or manual entry),
// so "+92..." and "0..." both show up depending on the source. This just
// normalizes how it's *shown* in the Orders table; nothing is rewritten
// in the database.
export function formatPakPhone(phone) {
  if (!phone) return phone;
  if (phone.startsWith("+92")) return `0${phone.slice(3)}`;
  if (/^92\d{10}$/.test(phone)) return `0${phone.slice(2)}`;
  return phone;
}

export default formatPakPhone;
