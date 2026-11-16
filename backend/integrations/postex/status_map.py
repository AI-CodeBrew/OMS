"""FynkTech's PostEx status mapping (the "FynkTech - Status Mapping - Postex"
sheet, 2026-11-16 version): what OMS shows - Sub Status and Tag - for each
PostEx status and remark.

Rules on top of the sheet (user, 2026-11-16):
- Before pickup (Unbooked / Booked / Expired) the order stays in Assigning
  Courier and only its Sub Status comes from here - the tag stays OMS's own
  print tag (To be printed, Airwaybill Printed, ...). Expired is the one
  exception: the booking is void, so its tag is "Voided".
- From Picked By PostEx onward the sheet gives both Sub Status and Tag.
- Out For Delivery stays in the Dispatched card (OMS has no card of its own
  for it).
- Un-Assigned By Me (cancelled on PostEx): back to Awaiting Confirmation,
  same order number - see oms.services.unbook_cancelled_by_courier_keep_number.

The card itself is moved by services.apply_postex_status; this module only
says which words go with it. To change a wording, change it here.
"""

import re

SUB_CREATING_BOOKING = "Creating Booking"
SUB_BOOKING_CREATED = "Booking Created"
SUB_BOOKING_EXPIRED = "Booking Expired"
TAG_VOIDED = "Voided"

SUB_PICKED = ("Picked from Warehouse", "Picked by Courier")
SUB_AT_HUB = ("In Transit", "Moving from Courier Hub")
SUB_EN_ROUTE = ("In Transit", "Moving towards Customer City")
SUB_OUT_FOR_DELIVERY = ("Out For Delivery", "Rider on the Way")
SUB_RE_ATTEMPT = ("Request to Re-attempt", "Re-Attempt")
# Delivery Under Review: PostEx waits for our Shipper Advice.
SUB_WAITING_ADVICE = ("Refused by Customer", "Waiting for Shipper Advice")
SUB_RETURNING = ("Returning", "Moving back to Warehouse")
SUB_DELIVERED = ("Delivered", "Delivered")
SUB_RETURNED = ("Returned to Warehouse", "Awaiting Scan")
TAG_RETURN_RECEIVED = "Return Received"
SUB_BOOKING_CANCELLED = "Booking Cancelled"
TAG_BOOKING_CANCELLED = "Cancelled from Assigning Courier"
# After our Shipper Advice, until PostEx's next status (same as Leopards).
TAG_REATTEMPT_REQUESTED = "Reattempt Requested"
TAG_RETURN_REQUESTED = "Return Requested"

# "Attempt Made: RFD(REFUSED TO RECEIVE)" - code -> (Sub Status, Tag).
ATTEMPT_CODES = {
    "RFD": ("Customer Refused", "Change of Mind"),
    "CNA": ("Customer not Available", "Not on Location"),
    "ICA": ("Incomplete Address", "Address Details Required"),
    "OPN": ("Customer Refused", "Open Parcel Request"),
    "HCR": ("Delivery on Hold", "Hold by Customer"),
}
# The same, by the words in brackets (a remark without its code).
ATTEMPT_TEXTS = {
    "REFUSED TO RECEIVE": "RFD",
    "CUSTOMER NOT AVAILABLE": "CNA",
    "INCOMPLETE ADDRESS": "ICA",
    "CONSIGNEE WANTS TO OPEN PARCEL": "OPN",
    "HOLD ON CONSIGNEE REQUEST": "HCR",
}

# PostEx's status texts, both vocabularies (track-order and get-all-order -
# see services._STAGE_BY_STATUS), grouped by the sheet row they belong to.
_PRE_PICKUP = {
    "unbooked": (SUB_CREATING_BOOKING, ""),
    "booked": (SUB_BOOKING_CREATED, ""),
    "expired": (SUB_BOOKING_EXPIRED, TAG_VOIDED),
}
_PICKED = {"picked by postex"}
_AT_HUB = {"postex warehouse", "in stock", "at postex warehouse"}
_EN_ROUTE = {"transferred", "en-route to postex warehouse"}
_OUT_FOR_DELIVERY = {"out for delivery", "ofd", "delivery en-route"}
_UNDER_REVIEW = {"delivery under review", "under verification"}

# Every tag this mapping can give - the Orders list's Tag filter offers them.
ALL_TAGS = list(dict.fromkeys([
    TAG_VOIDED, SUB_PICKED[1], SUB_AT_HUB[1], SUB_EN_ROUTE[1], SUB_OUT_FOR_DELIVERY[1],
    *[tag for _sub, tag in ATTEMPT_CODES.values()], SUB_RE_ATTEMPT[1],
    SUB_WAITING_ADVICE[1], TAG_REATTEMPT_REQUESTED, TAG_RETURN_REQUESTED,
    SUB_RETURNING[1], SUB_RETURNED[1], TAG_RETURN_RECEIVED, TAG_BOOKING_CANCELLED,
]))

_ATTEMPT = re.compile(r"^attempt made:\s*([^()]*?)\s*(?:\(([^()]+)\))?\s*$", re.IGNORECASE)


def _norm(text):
    return re.sub(r"\s+", " ", str(text or "").strip().lower())


def _newest(history):
    for entry in reversed(history or []):
        if isinstance(entry, dict):
            return entry
    return None


def latest_attempt(history):
    """(code, words) of the newest "Attempt Made: ..." in the history -
    ("RFD", "REFUSED TO RECEIVE") - or ("", "")."""
    for entry in reversed(history or []):
        if not isinstance(entry, dict):
            continue
        match = _ATTEMPT.match(str(entry.get("transactionStatusMessage") or "").strip())
        if match:
            return match.group(1).strip().upper(), (match.group(2) or "").strip().upper()
    return "", ""


def attempt_words(history):
    """(Sub Status, Tag) for a failed attempt, from its newest remark. A
    remark the sheet doesn't have: "Undelivered", with PostEx's own words
    as the tag."""
    code, words = latest_attempt(history)
    code = code if code in ATTEMPT_CODES else ATTEMPT_TEXTS.get(words, code)
    if code in ATTEMPT_CODES:
        return ATTEMPT_CODES[code]
    return "Undelivered", (words.title() or code or "Delivery Attempt Failed")


def pre_pickup_words(label):
    """(Sub Status, Tag) for Unbooked / Booked / Expired - the tag is "" for
    the first two (OMS's print tag shows) - or None."""
    return _PRE_PICKUP.get(_norm(label))


def sheet_words(stage, label, history):
    """(Sub Status, Tag) for an order the courier has (services.status_stage's
    stage), from Picked By PostEx onward, or None where the sheet doesn't
    apply (before pickup, cancelled, unknown)."""
    label_n = _norm(label)
    if stage == "return_in_progress":
        return SUB_RETURNING
    if stage == "returned":
        return SUB_RETURNED
    if stage == "delivered":
        return SUB_DELIVERED
    if stage == "out_for_delivery":
        return SUB_OUT_FOR_DELIVERY
    if stage == "attempt":
        newest = _newest(history) or {}
        if "re-attempt" in _norm(newest.get("transactionStatusMessage")):
            return SUB_RE_ATTEMPT
        if label_n in _UNDER_REVIEW:
            return SUB_WAITING_ADVICE
        return attempt_words(history)
    if stage == "dispatched":
        if label_n in _PICKED:
            return SUB_PICKED
        if label_n in _AT_HUB or label_n.startswith("at postex"):
            return SUB_AT_HUB
        if label_n in _EN_ROUTE or label_n.startswith("en-route to"):
            return SUB_EN_ROUTE
        return SUB_EN_ROUTE
    return None
