import random
import string


class SmartlaneAPIError(Exception):
    pass


def create_booking(order, api_key):
    """Creates a shipment booking on Smartlane for this order and returns
    the tracking number Smartlane assigns to it.

    STUB: no official Smartlane "create booking" API spec was available
    while building this integration (same caveat as the webhook receiver
    in integrations/views.py). This generates a local placeholder tracking
    number instead of calling a real endpoint, so the rest of the
    pipeline - Ready to Print, the loadsheet/airway bill, Ready to Pick -
    can be built and tested end-to-end right now. Replace the body below
    with a real POST to Smartlane's booking endpoint (using `api_key` and
    order/address/item data from `order`) once their API docs or a sample
    request/response are available.
    """
    if not api_key:
        raise SmartlaneAPIError("Add your Smartlane API key on the Smartlane integration page first.")

    suffix = "".join(random.choices(string.digits, k=9))
    return f"SL{suffix}"
