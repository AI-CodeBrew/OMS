"""FynkTech's Smartlane status mapping (the "FynkTech - Status Mapping -
Smartlane" sheet, 2026-11-16 version): what OMS shows - Sub Status and Tag
- for each Smartlane stage, from Dispatched onward.

Rules on top of the sheet (user, 2026-11-16):
- Before Dispatched (Queue / Ready) nothing changes - booking, printing and
  packing behave as they always have.
- Out for Delivery stays in the Dispatched card (OMS has no card of its own
  for it).
- Dispute ("not received by customer"), even after Delivered: Undelivered /
  Delivery under Review / Not Received by Customer
  (oms.services.mark_disputed_by_courier).
- Cancel: back to Awaiting Confirmation under the same order number
  (oms.services.unbook_cancelled_by_courier_keep_number); it only changes
  if the order is booked with Smartlane again.

The words go by the card the order ends up on (services.apply_smartlane_status
moves it); the carrier's reason is the newest "Ready for Return - <REASON>"
step Leopards writes into Smartlane's tracking history (Barq Raftar via
Smartlane gives none). To change a wording, change it here.
"""

import re

from integrations.leopards.status_map import ATTEMPT_REASONS as LEOPARDS_REASONS

SUB_IN_TRANSIT = ("In Transit", "Moving towards Customer City")
SUB_OUT_FOR_DELIVERY = ("Rider on the Way", "Rider on the Way")
SUB_RETURNING = ("Returning", "Moving back to Warehouse")
SUB_DELIVERED = ("Delivered", "Delivered")
SUB_DISPUTE = ("Delivery under Review", "Not Received by Customer")
SUB_RETURNED_NO_REASON = ("Returned", "Returned")
TAG_RETURN_RECEIVED = "Return Received"
SUB_BOOKING_CANCELLED = "Booking Cancelled"
TAG_BOOKING_CANCELLED = "Cancelled from Assigning Courier"
TAG_REATTEMPT_REQUESTED = "Reattempt Requested"
TAG_RETURN_REQUESTED = "Return Requested"
TAG_ATTEMPT_NO_REASON = "Delivery Attempt Failed"

# Returned + "Return To Sender" + reason -> (Sub Status, Tag): the same
# reasons and words as the Leopards sheet's (Leopards delivers most
# Smartlane parcels).
RETURN_REASONS = dict(LEOPARDS_REASONS)

ALL_TAGS = list(dict.fromkeys([
    SUB_IN_TRANSIT[1], SUB_OUT_FOR_DELIVERY[1], SUB_RETURNING[1], SUB_DELIVERED[1], SUB_DISPUTE[1],
    SUB_RETURNED_NO_REASON[1], TAG_ATTEMPT_NO_REASON, TAG_REATTEMPT_REQUESTED, TAG_RETURN_REQUESTED,
    TAG_RETURN_RECEIVED, TAG_BOOKING_CANCELLED,
    *[tag for _sub, tag in RETURN_REASONS.values()],
]))


def normalize_reason(reason):
    return re.sub(r"\s+", " ", str(reason or "")).strip().upper()


def returned_words(reason):
    """(Sub Status, Tag) for a Returned parcel: by the carrier's reason, or
    Returned / Returned without one (or one the sheet doesn't have - then
    the reason itself is the tag)."""
    key = normalize_reason(reason)
    if key in RETURN_REASONS:
        return RETURN_REASONS[key]
    if key:
        return SUB_RETURNED_NO_REASON[0], key.title()
    return SUB_RETURNED_NO_REASON


def attempt_words(reason):
    """(Sub Status, Tag) for Undelivered: "Undelivered" with the carrier's
    reason as the tag (the sheet's "Reason from Courier API")."""
    key = normalize_reason(reason)
    return "Undelivered", (key.title() if key else TAG_ATTEMPT_NO_REASON)


def sheet_words(card, *, status, disputed, reason):
    """(Sub Status, Tag) for an order on `card` (oms.services.workflow_card,
    after the status was applied), or None where the sheet doesn't apply
    (before Dispatched, cancelled, awaiting confirmation)."""
    if card == "return_in_transit":
        return SUB_RETURNING
    if card == "undelivered":
        return SUB_DISPUTE if disputed else attempt_words(reason)
    if card == "dispatched":
        return SUB_OUT_FOR_DELIVERY if status == "out_for_delivery" else SUB_IN_TRANSIT
    if card == "delivered":
        return SUB_DELIVERED
    if card == "returned":
        return returned_words(reason)
    return None
