"""What a barcode/QR scanner typed, cleaned down to the code OMS looks up.

Every scan screen (Assigning Courier's Scan to Pack, dispatch, the returns
desk, the WMS packing page) runs its input through scanned_code() before
searching, so they all accept the same things.

Leopards' airway bill carries a QR code next to the barcode, and the QR
reads "LE7548992901,592,2000.00" - the tracking number (CN), then two more
values (a Leopards code and the COD amount). Scanning it used to search for
that whole string and find nothing. Only the first part is the tracking
number, so that's what is kept. A plain barcode ("LE7548992901") has no
comma and passes through unchanged.
"""


def scanned_code(value):
    """The code to look up: trimmed, and only the part before the first
    comma when the scan carries several comma-separated values."""
    text = str(value or "").strip()
    if "," in text:
        text = next((part.strip() for part in text.split(",") if part.strip()), "")
    return text
