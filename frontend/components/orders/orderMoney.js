// Client-side mirror of Order.grand_total / amount_receivable (backend
// oms/models.py), so the detail panel's money cells follow an edit live
// instead of showing the saved figures until Save.

function n(value) {
  return Number(value) || 0;
}

export function draftSubtotal(draft) {
  return (draft.items || []).reduce((sum, i) => sum + n(i.quantity) * n(i.unit_price), 0);
}

export function draftGrandTotal(draft) {
  return (
    draftSubtotal(draft) -
    n(draft.coupon_discount) -
    n(draft.gift_card_discount) -
    n(draft.loyalty_amount) -
    n(draft.wallet_amount) +
    n(draft.total_tax) +
    n(draft.donation_amount) +
    n(draft.shipping_amount) +
    n(draft.express_stitching_amount)
  );
}

// What the customer actually owes: the grand total (Shopify's) less the
// discount given here in OMS on top of Shopify's (extra_discount).
export function draftPayable(draft) {
  return draftGrandTotal(draft) - n(draft.extra_discount);
}

// The Discount cell: Shopify's discount plus the one given here.
export function draftDiscountTotal(draft) {
  return n(draft.coupon_discount) + n(draft.extra_discount);
}

// Mirror of Order.is_fully_prepaid: Prepaid (not COD) or Paid, but not
// Partially Paid - nothing left to collect on delivery.
export function draftIsFullyPrepaid(draft) {
  if (draft.payment_status === "paid") return true;
  return draft.payment_gateway !== "cod" && draft.payment_status !== "partially_paid";
}

// A fully prepaid draft keeps Amount Paid at the whole amount payable, so
// an edit (items, shipping, discount...) never leaves a receivable on it.
export function withPrepaidPaid(draft) {
  if (!draftIsFullyPrepaid(draft)) return draft;
  return { ...draft, amount_paid: Math.max(draftPayable(draft), 0).toFixed(2) };
}

export function draftReceivable(draft) {
  if (draft.payment_status === "paid" && !n(draft.amount_paid)) return 0;
  return Math.max(draftPayable(draft) - n(draft.amount_paid), 0);
}
