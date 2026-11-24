"""FynkTech's Leopards status mapping (the "FynkTech - Status Mapping -
Leopards" sheet, 2026-11-15 version): what OMS shows - Sub Status and Tag -
for each Leopards status and reason, from Shipment Picked onward.

Before Shipment Picked nothing here applies: booking, printing and packing
behave as they always have (sheet_status returns None). The status itself
(the card) is moved by services.apply_leopards_status; this module only
says which words go with it.

To change a wording, change it here - the sheet is the source.
docs: md-files/LEOPARDS_STATUS_MAPPING_PLAN.md.
"""

import re

# Sheet decisions on top of the sheet (user, 2026-11-15).
SUB_PICKED = ("Picked from Warehouse", "Picked by Courier")
SUB_IN_TRANSIT = ("In Transit", "Moving towards Customer City")
SUB_OUT_FOR_DELIVERY = ("Out For Delivery", "Rider on the Way")
SUB_DELIVERED = ("Delivered", "Delivered")
# Ready for Return: Leopards waits for our Shipper Advice.
SUB_WAITING_ADVICE = ("Refused by Customer", "Waiting for Shipper Advice")
# Ready for Return, but Leopards has no open request for our advice on its
# Shipper Advice list (not opened yet, or closed) - it would refuse one, so
# the order stays out of the "Shipper Advice Needed" card (user, 2026-11-24).
# "Waiting for Shipper Advice" is only given while the list has an open
# request (services.sync_shipper_advice_requests).
TAG_READY_FOR_RETURN = "Ready for Return"
# Being Return / Reverse Leg: already on its way back (Return in Transit).
SUB_RETURNING = ("Returning", "Moving back to Warehouse")
SUB_RETURNED = ("Returned to Warehouse", "Awaiting Scan")
TAG_RETURN_RECEIVED = "Return Received"
SUB_BOOKING_CANCELLED = "Booking Cancelled"
# After our Shipper Advice, until Leopards' next status.
TAG_REATTEMPT_REQUESTED = "Reattempt Requested"
TAG_RETURN_REQUESTED = "Return Requested"
ADVICE_TAGS = {"Reattempt": TAG_REATTEMPT_REQUESTED, "Return": TAG_RETURN_REQUESTED}

# First/Second Attempt: reason -> (Sub Status base, Tag). The Sub Status is
# "<base> - 1st Attempt" / "- 2nd Attempt".
ATTEMPT_REASONS = {
    "CONSIGNEE REFUSED": ("Customer Refused", "Change of Mind"),
    "REFUSED WITH NO REASON": ("Customer Refused", "Change of Mind"),
    "REFUSED AFTER FORCEFULLY OPENED": ("Customer Refused", "Parcel Opened then Refused"),
    "REFUSED AFTER DUPLICATION": ("Customer Refused", "Duplicate Order"),
    "REFUSE TO SIGN DC": ("Customer Refused", "Not Signing Delivery Receipt"),
    "CONSIGNEE NOT AVAILABLE": ("Customer not Available", "Not on Location"),
    "CONSIGNEE NOT CAME": ("Customer not Available", "Not on Location"),
    "ON ARRIVAL - CLOSED": ("Customer not Available", "Location Closed"),
    "NO SUCH CONSIGNEE EXISTS": ("Customer not Available", "Fake Customer Name"),
    "NEED HOUSE/FLAT #": ("Incomplete Address", "Address Details Required"),
    "NEED BLOCK/SECTOR/PHASE #": ("Incomplete Address", "Address Details Required"),
    "NEED OFFICE/SHOP #": ("Incomplete Address", "Address Details Required"),
    "NEED LANDMARK/CARE-OFF": ("Incomplete Address", "Address Details Required"),
    "CASH NOT AVAILABLE": ("Cash not Available", "No Cash"),
    "FAKE ORDER": ("Customer Refused", "Fake Order - Customer Confirmed"),
    "DUPLICATE ORDER": ("Duplicate Parcel", "Duplicate Order"),
    "OPEN SHIPMENT DELIVERY DEMAND": ("Customer Refused", "Open Parcel Request"),
    "ITEM DIFFERENT TO ORDERED": ("Customer Refused", "Product is Different"),
    "QUALITY ISSUE": ("Customer Refused", "Quality Issue"),
    "DAMAGED/UNACCEPTABLE CONDITION": ("Customer Refused", "Damaged Parcel"),
    "DELAYED DELIVERY": ("Customer Refused", "Delay in Delivery"),
}

# Every tag this mapping can give - the Orders list's Tag filter offers them.
ALL_TAGS = list(dict.fromkeys([
    SUB_PICKED[1], SUB_IN_TRANSIT[1], SUB_OUT_FOR_DELIVERY[1],
    *[tag for _base, tag in ATTEMPT_REASONS.values()],
    SUB_WAITING_ADVICE[1], TAG_READY_FOR_RETURN, TAG_REATTEMPT_REQUESTED, TAG_RETURN_REQUESTED,
    SUB_RETURNING[1], SUB_RETURNED[1], TAG_RETURN_RECEIVED,
]))


def normalize_reason(reason):
    """Leopards' reason as the sheet spells it: upper case, single spaces.
    Its webhook sometimes sends lists ("['']") - those count as none."""
    text = str(reason or "").strip()
    if text.startswith("[") and text.endswith("]"):
        text = ",".join(part.strip(" '\"") for part in text[1:-1].split(",")).strip(", ")
    return re.sub(r"\s+", " ", text).upper().strip(" -")


def attempt_words(attempt, reason):
    """(Sub Status, Tag) for a failed delivery attempt (1 or 2). A reason the
    sheet doesn't have: "Undelivered - Nth Attempt" with Leopards' own
    remark as the tag."""
    nth = "1st" if attempt == 1 else "2nd"
    key = normalize_reason(reason)
    if key in ATTEMPT_REASONS:
        base, tag = ATTEMPT_REASONS[key]
        return f"{base} - {nth} Attempt", tag
    return f"Undelivered - {nth} Attempt", (key.title() if key else "Delivery Attempt Failed")


def sheet_words(stage, *, attempt=1, reason=""):
    """(Sub Status, Tag) for a Leopards stage (services.status_stage's,
    with "waiting_advice" for Ready for Return), or None where the sheet
    doesn't apply (before Shipment Picked, cancelled)."""
    if stage == "picked":
        return SUB_PICKED
    if stage == "dispatched":
        return SUB_IN_TRANSIT
    if stage == "out_for_delivery":
        return SUB_OUT_FOR_DELIVERY
    if stage == "attempt":
        return attempt_words(attempt, reason)
    if stage == "waiting_advice":
        return SUB_WAITING_ADVICE
    if stage == "return_in_progress":
        return SUB_RETURNING
    if stage == "returned":
        return SUB_RETURNED
    if stage == "delivered":
        return SUB_DELIVERED
    return None
