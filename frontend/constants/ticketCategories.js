// Standard starting set for an OMS/courier support desk. Edit freely - the
// create-ticket dialog just reads this object, category -> sub-categories.
export const TICKET_CATEGORIES = {
  "Delivery Issue": ["Late delivery", "Damaged item", "Lost shipment", "Wrong address"],
  "Order Issue": ["Wrong item received", "Missing item", "Cancellation request", "Edit request"],
  "Payment / COD": ["Amount mismatch", "COD not remitted", "Refund request"],
  "Returns": ["Return not picked up", "Return status unclear"],
  Other: ["Account", "General question"],
};

export default TICKET_CATEGORIES;
