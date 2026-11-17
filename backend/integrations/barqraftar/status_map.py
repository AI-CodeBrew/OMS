"""FynkTech's BarqRaftar status mapping (the "FynkTech - Status Mapping -
Barq Raftar" sheet, 2026-11-16 version): what OMS shows - Sub Status and
Tag - for each BarqRaftar status, from Picked Up onward.

Rules on top of the sheet (user, 2026-11-16):
- Before Picked Up (Pending / Awaiting Pickup) nothing changes - booking,
  printing and packing behave as they always have.
- Dispatched (4) - BarqRaftar's word for out with the rider - stays in the
  Dispatched card (OMS has no Out for Delivery card).
- Return Confirmation (12) waits for our Shipper Advice: Undelivered, not
  Return in Transit.
- Cancelled (99): back to Awaiting Confirmation under the same order
  number (oms.services.unbook_cancelled_by_courier_keep_number); it only
  changes if the order is booked with BarqRaftar again.

Return by Consignee's reason: BarqRaftar's API (GET /order and
get_multiple_orders) carries none - `remarks` comes back empty and the
status logs hold only codes (checked live, 2026-11-16). When `remarks` does
carry one it's mapped below; otherwise the sheet's last Return by Consignee
row applies (Undelivered / Undelivered).

The card itself is moved by services.apply_barqraftar_status; this module
only says which words go with it. To change a wording, change it here.
"""

import re

# Pending (1) - BarqRaftar's portal calls it "Booked": the booking and AWB
# exist, the parcel just isn't handed over yet. Shown as "Booking Created"
# (same word as PostEx's Booked) instead of "Pending", which read as "not
# booked" (user, 2026-11-17). Sub Status only - the tag stays OMS's own
# print tag, as for PostEx before pickup. Awaiting Pickup (2) keeps
# BarqRaftar's own word.
SUB_BOOKING_CREATED = "Booking Created"
PRE_PICKUP_SUB_STATUS = {1: SUB_BOOKING_CREATED}

SUB_PICKED = ("Picked from Warehouse", "Picked by Courier")
SUB_EN_ROUTE = ("In Transit", "Moving towards Customer City")
SUB_AT_HUB = ("In Transit", "Moving from Courier Hub")
SUB_OUT_FOR_DELIVERY = ("Out For Delivery", "Rider on the Way")
SUB_RE_ATTEMPT = ("Request to Re-attempt", "Re-Attempt")
SUB_HOLD_CS = ("Delivery on Hold", "Hold by CS")
SUB_WAITING_ADVICE = ("Refused by Customer", "Waiting for Shipper Advice")
SUB_RETURNING = ("Returning", "Moving back to Warehouse")
SUB_DELIVERED = ("Delivered", "Delivered")
SUB_RETURNED = ("Returned to Warehouse", "Awaiting Scan")
TAG_RETURN_RECEIVED = "Return Received"
SUB_BOOKING_CANCELLED = "Booking Cancelled"
TAG_BOOKING_CANCELLED = "Cancelled from Assigning Courier"
TAG_REATTEMPT_REQUESTED = "Reattempt Requested"
TAG_RETURN_REQUESTED = "Return Requested"
# Return by Consignee with no reason we can read.
SUB_UNDELIVERED = ("Undelivered", "Delivery Attempt Failed")

# Return by Consignee (5): reason -> (Sub Status, Tag). Keys are matched
# case-insensitively against the start of BarqRaftar's remark; the rider's
# own words in brackets after it are ignored.
ATTEMPT_REASONS = {
    "consignee not available": ("Customer not Available", "Not on Location"),
    "order refuse by consignee": ("Customer Refused", "Change of Mind"),
    "incomplete/address not found": ("Incomplete Address", "Address Details Required"),
    "non service area": ("Non Service Area", "Remote Area"),
    "order holded by consignee": ("Delivery on Hold", "Hold by Customer"),
}

# BarqRaftar status id -> (Sub Status, Tag), from Picked Up onward.
BY_CODE = {
    3: SUB_PICKED,             # Picked Up
    30: SUB_EN_ROUTE,          # RFC Origin
    31: SUB_EN_ROUTE,          # In Transit
    32: SUB_AT_HUB,            # Received at FC
    4: SUB_OUT_FOR_DELIVERY,   # Dispatched (rider out)
    6: SUB_RE_ATTEMPT,         # Re-Attempt Requested
    14: SUB_RE_ATTEMPT,        # Re-attempt Approval
    7: SUB_HOLD_CS,            # Hold Requested
    12: SUB_WAITING_ADVICE,    # Return Confirmation
    8: SUB_RETURNING,          # Return Requested
    10: SUB_RETURNING,         # Return Transit
    11: SUB_RETURNING,         # Return In Progress
    13: SUB_RETURNING,         # RFC Origin (Return)
    9: SUB_DELIVERED,          # Delivered (incl. QR payment)
    98: SUB_RETURNED,          # Returned to Shipper
}
RETURN_BY_CONSIGNEE = 5

# Every tag this mapping can give - the Orders list's Tag filter offers them.
ALL_TAGS = list(dict.fromkeys([
    *[tag for _sub, tag in BY_CODE.values()],
    *[tag for _sub, tag in ATTEMPT_REASONS.values()],
    SUB_UNDELIVERED[1], TAG_REATTEMPT_REQUESTED, TAG_RETURN_REQUESTED,
    TAG_RETURN_RECEIVED, TAG_BOOKING_CANCELLED,
]))


def clean_remark(remark):
    """BarqRaftar's remark, or "" for none (its API sends None / "None")."""
    text = re.sub(r"\s+", " ", str(remark or "")).strip()
    return "" if text.lower() in ("", "none", "null", "-") else text


def attempt_words(remark):
    """(Sub Status, Tag) for Return by Consignee, from BarqRaftar's remark.
    A reason the sheet doesn't have: "Undelivered", with the reason as the
    tag; no reason at all: "Undelivered" / "Delivery Attempt Failed"."""
    text = clean_remark(remark)
    if not text:
        return SUB_UNDELIVERED
    lowered = text.lower()
    for reason, words in ATTEMPT_REASONS.items():
        if lowered.startswith(reason):
            return words
    return SUB_UNDELIVERED[0], text[:100]


def sheet_words(code, remark=""):
    """(Sub Status, Tag) for a BarqRaftar status id from Picked Up onward,
    or None where the sheet doesn't apply (before pickup, cancelled,
    unknown)."""
    if code == RETURN_BY_CONSIGNEE:
        return attempt_words(remark)
    return BY_CODE.get(code)
