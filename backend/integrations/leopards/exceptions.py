class LeopardsAPIError(Exception):
    """Raised for any Leopards HTTP/credential/response-shape failure - same
    role as PostExAPIError. Kept inside this package so Leopards code never
    imports anything from the Smartlane, BarqRaftar or PostEx integrations,
    and vice versa.

    `kind` tells the caller whether retrying a smaller request can help:
    "auth" (api_key / api_password refused) and "network" (unreachable /
    timed out) won't be fixed by splitting a batch, "api" (Leopards answered
    with an error for this request - e.g. one unknown CN in a bulk track)
    might."""

    def __init__(self, message, kind="api"):
        super().__init__(message)
        self.kind = kind


class LeopardsBookingError(Exception):
    """Raised when a Leopards booking/cancel is refused for a reason the
    caller should show to the user (wrong order status, not connected, city
    not served, parcel already picked up, ...) - same role as
    PostExBookingError. Deliberately not a subclass of LeopardsAPIError (or
    of the other couriers' errors), so oms/views.py's bulk-action except
    tuple can list it on its own."""
