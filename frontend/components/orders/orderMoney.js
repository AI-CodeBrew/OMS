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

export function draftReceivable(draft) {
  if (draft.payment_status === "paid" && !n(draft.amount_paid)) return 0;
  return Math.max(draftGrandTotal(draft) - n(draft.amount_paid), 0);
}
