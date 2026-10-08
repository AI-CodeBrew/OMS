class PostExAPIError(Exception):
    """Raised for any PostEx HTTP/token/response-shape failure - same role as
    integrations.barqraftar.exceptions.BarqRaftarAPIError. Kept inside this
    package so PostEx code never imports anything from the Smartlane or
    BarqRaftar integrations, and vice versa."""


class PostExBookingError(Exception):
    """Raised when a PostEx booking/cancel is refused for a reason the caller
    should show to the user (wrong order status, not connected, city not
    served, parcel already picked up, ...) - same role as
    BarqRaftarBookingError. Deliberately not a subclass of either that or
    PostExAPIError, so oms/views.py's bulk-action except tuple can list it
    on its own."""
