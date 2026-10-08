import uuid

from django.db import models

from core.models import TenantScopedModel

# Everything PostEx-specific lives in its own Postgres schema
# ("postex_integrations") in Supabase, separate from Smartlane/Shopify's
# "integrations" schema and BarqRaftar's "barqraftar_integrations" - see
# migrations/0020_postex.py, which creates it. Table names inside it are
# short since the schema already says which integration they belong to.
SCHEMA = "postex_integrations"


class PostExConnection(TenantScopedModel):
    """One PostEx merchant account per organization - same shape/role as
    BarqRaftarConnection, kept entirely separate from it."""

    api_token = models.CharField(max_length=255, blank=True, default="")
    is_connected = models.BooleanField(default=False)
    # "Fynk Tech" etc. - PostEx's own name for the account (merchantName on
    # any order row). Shown on the integration page so it's obvious which
    # PostEx account is connected.
    merchant_name = models.CharField(max_length=255, blank=True, default="")

    # The ACTIVE pickup address - one of the addresses saved on PostEx,
    # picked with "Set as active" on the Pickup Addresses tab. Its
    # addressCode ("001", "002", ...) goes out as pickupAddressCode on every
    # booking - see services._build_order_payload.
    pickup_address_code = models.CharField(max_length=20, blank=True, default="")
    pickup_address_label = models.CharField(max_length=255, blank=True, default="")
    pickup_city_name = models.CharField(max_length=150, blank=True, default="")

    # Booking options, editable from the Settings card.
    default_order_type = models.CharField(max_length=20, default="Normal")
    # Sent as transactionNotes on every booking (rider-facing note, e.g.
    # "Call before delivery").
    default_notes = models.CharField(max_length=255, blank=True, default="")

    # Cached GET /v2/get-operational-city delivery cities (~900 names),
    # refreshed at most once a day - see services.get_cities.
    cities_cache = models.JSONField(default=list, blank=True)
    cities_cached_at = models.DateTimeField(null=True, blank=True)
    # Manual overrides for cities whose PostEx spelling doesn't match the
    # order's city text - edited from the Cities tab, checked before the
    # built-in alias list in services.py.
    city_aliases = models.JSONField(default=dict, blank=True)

    # PostEx has no webhooks, so statuses arrive only through the poller /
    # "Sync now" - this is the last time either finished.
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = f'"{SCHEMA}"."connections"'
        constraints = [
            models.UniqueConstraint(fields=["organization"], name="postex_one_connection_per_org")
        ]

    def __str__(self):
        return f"PostEx ({self.organization_id})"


class PostExShipment(TenantScopedModel):
    """One PostEx consignment for one Order - lets every other piece of PostEx
    code (poller, cancel, airway bill, load sheet) find "is this order booked
    with PostEx" from a real row, never from the order's courier name alone.
    Same role as BarqRaftarShipment."""

    order = models.ForeignKey("oms.Order", on_delete=models.CASCADE, related_name="postex_shipments")
    # Our orderRefNumber on PostEx (the order number without '#', or -R2...
    # on a rebook after a cancel - see services._next_reference).
    reference = models.CharField(max_length=100)
    tracking_number = models.CharField(max_length=100, blank=True, default="")
    # PostEx's own transactionStatus text, as last reported ("Booked",
    # "PostEx WareHouse", "Out For Delivery", ...).
    status_label = models.CharField(max_length=100, blank=True, default="")
    status_history = models.JSONField(default=list, blank=True)
    last_payload = models.JSONField(default=dict, blank=True)
    pickup_address_code = models.CharField(max_length=20, blank=True, default="")

    # False once cancelled (locally or on PostEx) - a rebook then creates a
    # fresh active row and this one stays as history.
    is_active = models.BooleanField(default=True)
    booked_at = models.DateTimeField(auto_now_add=True)
    # Set when our "Print PostEx Load Sheet" generated PostEx's load sheet
    # for this parcel (PostEx's Unbooked -> Booked hand-over step).
    load_sheet_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    # Drives the poller's rotation.
    last_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = f'"{SCHEMA}"."shipments"'
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="postex_reference_unique_per_org"
            ),
            models.UniqueConstraint(
                fields=["order"],
                condition=models.Q(is_active=True),
                name="postex_one_active_shipment_per_order",
            ),
        ]
        indexes = [
            models.Index(
                fields=["organization", "is_active", "last_checked_at"], name="postex_shipment_poll_idx"
            ),
            models.Index(fields=["organization", "tracking_number"], name="postex_shipment_tn_idx"),
        ]

    def __str__(self):
        return f"PostEx shipment {self.reference} ({self.tracking_number or 'no tracking yet'})"


class PostExSyncJob(TenantScopedModel):
    """One background PostEx status-sync run - mirror of BarqRaftarSyncJob so
    the "Sync now" UX matches."""

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
