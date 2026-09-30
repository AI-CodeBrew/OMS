import uuid

from django.db import models

from core.models import TenantScopedModel

# Everything BarqRaftar-specific lives in its own Postgres schema
# ("barqraftar_integrations"), separate from Smartlane/Shopify's
# "integrations" schema - see migrations/0017_barqraftar.py, which creates
# it. Table names inside it are short (just "connections", "shipments",
# "sync_jobs") since the schema itself already says which integration they
# belong to.
SCHEMA = "barqraftar_integrations"


class BarqRaftarConnection(TenantScopedModel):
    """One BarqRaftar courier account per organization - same shape/role as
    integrations.models.SmartlaneConnection, kept entirely separate so
    nothing here can ever affect Smartlane's own connection row or logic."""

    api_key = models.CharField(max_length=255, blank=True, default="")
    api_secret = models.CharField(max_length=255, blank=True, default="")
    is_connected = models.BooleanField(default=False)

    # Identifies which org a webhook POST belongs to (embedded in the
    # callback URL registered with BarqRaftar support) - same convention as
    # SmartlaneConnection.webhook_token. Never regenerated after connect.
    webhook_token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    last_event_at = models.DateTimeField(null=True, blank=True)
    events_received_count = models.PositiveIntegerField(default=0)

    # The ACTIVE pickup address (one of the addresses saved on BarqRaftar,
    # picked with "Set as active" on the Pickup Addresses tab). Every booking
    # goes out from it, with a pickup request - see services.book_orders.
    # from_city_id/from_city_name are that address's city.
    pickup_address_id = models.CharField(max_length=100, blank=True, default="")
    pickup_address_label = models.CharField(max_length=255, blank=True, default="")
    from_city_id = models.CharField(max_length=50, blank=True, default="")
    from_city_name = models.CharField(max_length=150, blank=True, default="")

    # No longer read anywhere - bookings now always create a pickup request
    # at the active address (the only way BarqRaftar ties an order to a
    # pickup address). Kept only so migration 0017 stays unchanged.
    create_pickup_request = models.BooleanField(default=True)
    # Booking options, editable from the Settings card.
    default_weight_grams = models.PositiveIntegerField(default=500)
    label_format = models.CharField(max_length=10, default="a4")  # "a4" | "6x4"

    # Cached GET /cities response, refreshed at most once a day (see
    # services.resolve_city_id) - avoids one extra BarqRaftar call on every
    # single booking just to re-fetch a list that rarely changes.
    cities_cache = models.JSONField(default=list, blank=True)
    cities_cached_at = models.DateTimeField(null=True, blank=True)
    # Manual overrides for cities whose BarqRaftar spelling doesn't match
    # the order's city text (e.g. "Pindi" -> "Rawalpindi") - edited from the
    # Cities tab, checked before the built-in alias list in services.py.
    city_aliases = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = f'"{SCHEMA}"."connections"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization"], name="barqraftar_one_connection_per_org"
            )
        ]

    def __str__(self):
        return f"BarqRaftar ({self.organization_id})"


class BarqRaftarShipment(TenantScopedModel):
    """One BarqRaftar consignment for one Order - the record that lets every
    other piece of BarqRaftar code (poller, cancel, labels, webhook) find
    "is this order actually booked with BarqRaftar" without ever guessing
    from the Order's courier name, which is not reliable (CSV imports and
    Shopify's own fulfillment sync both write arbitrary courier names, and
    Smartlane itself can route a parcel to a real-world courier also named
    BarqRaftar - see oms/services.py's cancel_order for how that risk is
    avoided)."""

    order = models.ForeignKey(
        "oms.Order", on_delete=models.CASCADE, related_name="barqraftar_shipments"
    )
    reference_id = models.CharField(max_length=100)
    tracking_number = models.CharField(max_length=100, blank=True, default="")
    status_code = models.PositiveIntegerField(null=True, blank=True)
    status_label = models.CharField(max_length=100, blank=True, default="")
    status_logs = models.JSONField(default=list, blank=True)
    last_payload = models.JSONField(default=dict, blank=True)

    # False once the shipment is cancelled (locally or on BarqRaftar) - lets
    # a rebook after a cancel create a fresh active row while this one stays
    # around as history, and lets every "is this order BarqRaftar's" check
    # filter to is_active=True.
    is_active = models.BooleanField(default=True)
    pickup_requested = models.BooleanField(default=False)
    booked_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    # Drives the poller's rotation, same role as oms.Order.smartlane_checked_at.
    last_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = f'"{SCHEMA}"."shipments"'
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference_id"], name="barqraftar_reference_unique_per_org"
            ),
            # At most one *active* shipment per order - a rebook after a
            # cancel is a new row, not a reused one, so history (the
            # cancelled row) is never overwritten.
            models.UniqueConstraint(
                fields=["order"],
                condition=models.Q(is_active=True),
                name="barqraftar_one_active_shipment_per_order",
            ),
        ]
        indexes = [
            models.Index(
                fields=["organization", "is_active", "last_checked_at"],
                name="barqraftar_shipment_poll_idx",
            ),
            models.Index(fields=["organization", "tracking_number"], name="barqraftar_shipment_tn_idx"),
        ]

    def __str__(self):
        return f"BarqRaftar shipment {self.reference_id} ({self.tracking_number or 'no CN yet'})"


class BarqRaftarSyncJob(TenantScopedModel):
    """Tracks one background BarqRaftar status-sync run - exact mirror of
    integrations.models.SmartlaneSyncJob, so the "Sync now" UX on the
    BarqRaftar page matches Smartlane's."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    cancel_requested = models.BooleanField(default=False)
    checked_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    total_available = models.PositiveIntegerField(null=True, blank=True)
    error_message = models.CharField(max_length=500, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = f'"{SCHEMA}"."sync_jobs"'
        ordering = ["-created_at"]
