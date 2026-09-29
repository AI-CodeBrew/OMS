class BarqRaftarAPIError(Exception):
    """Raised for any BarqRaftar HTTP/credentials/response-shape failure -
    same role as integrations.smartlane_client.SmartlaneAPIError. Kept
    inside this package rather than the shared exceptions module so
    BarqRaftar code never needs to import anything from the Smartlane
    integration, and vice versa."""


class BarqRaftarBookingError(Exception):
    """Raised when a BarqRaftar booking/cancel is refused for a reason the
    caller should show to the user (wrong order status, no connection, no
    city match, courier says the parcel is already picked up, ...) - same
    role as oms.services.SmartlaneBookingError. Deliberately NOT a subclass
    of that class or of BarqRaftarAPIError, so oms/views.py's bulk-action
    except tuple can list it independently without ever widening what the
    Smartlane branch there catches."""
