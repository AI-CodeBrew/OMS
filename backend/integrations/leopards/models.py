import secrets
import uuid

from django.db import models

from core.models import TenantScopedModel

# Everything Leopards-specific lives in its own Postgres schema
# ("leopards_integrations") in Supabase, separate from Smartlane/Shopify's
# "integrations" schema, BarqRaftar's "barqraftar_integrations" and PostEx's
# "postex_integrations" - see migrations/0026_leopards.py (and the matching
# plain SQL in leopards/sql/), which create it. Table names inside it are
# short since the schema already says which integration they belong to.
SCHEMA = "leopards_integrations"

# The header name the merchant registers with Leopards' Push API (the "custom
# request headers" its Push API document asks for); its value is the
# connection's webhook_secret. Leopards then sends it on every status push.
WEBHOOK_HEADER_KEY = "X-OMS-Webhook-Secret"


def new_webhook_secret():
    return secrets.token_urlsafe(32)


class LeopardsConnection(TenantScopedModel):
    """One Leopards merchant account (api_key + api_password) per
    organization - same shape/role as PostExConnection, kept entirely
    separate from it."""

    api_key = models.CharField(max_length=255, blank=True, default="")
    api_password = models.CharField(max_length=255, blank=True, default="")
    is_connected = models.BooleanField(default=False)
    # Leopards' own name for the account, when known - shown on the
    # integration page so it's obvious which account is connected.
    shipper_name = models.CharField(max_length=255, blank=True, default="")

    # City parcels leave from. Empty = "self": Leopards uses the city
    # registered on the account. Set it only to override that.
    origin_city_id = models.PositiveIntegerField(null=True, blank=True)
    origin_city_name = models.CharField(max_length=150, blank=True, default="")

    # Booking options, editable from the Settings card.
    # Used when no item on the order has a weight - Leopards wants grams.
    default_weight_grams = models.PositiveIntegerField(default=500)
    # Leopards' shipment type name ("overnight", ...). Empty = Leopards'
    # own default.
    default_shipment_type = models.CharField(max_length=50, blank=True, default="")
    # Sent as special_instructions on every booking (rider-facing note,
    # e.g. "Call before delivery"). Leopards requires the field, so an
    # empty note goes out as "N/A" - see services._build_packet.
    default_notes = models.CharField(max_length=255, blank=True, default="")
    # Leopards' generateLoadSheet asks for a courier name and code on every
    # sheet. Editable here since what it wants in them isn't documented.
    load_sheet_courier_name = models.CharField(max_length=100, default="FynkTech OMS")
    load_sheet_courier_code = models.CharField(max_length=30, default="1")

    # Cached getAllCities rows ([{id, name, origin, destination}], ~1000
    # cities), refreshed at most once a day - see services.get_cities.
    cities_cache = models.JSONField(default=list, blank=True)
    cities_cached_at = models.DateTimeField(null=True, blank=True)
    # Manual overrides for cities whose Leopards spelling doesn't match the
    # order's city text - edited from the Cities tab, checked before the
    # built-in alias list in services.py.
    city_aliases = models.JSONField(default=dict, blank=True)

    # Last time the poller / "Sync now" finished - the backup status feed
    # behind the Push API webhook below.
    last_synced_at = models.DateTimeField(null=True, blank=True)

    # Status webhook (Leopards' Push API). webhook_token identifies the org
    # in the callback URL; webhook_secret must arrive as the
    # WEBHOOK_HEADER_KEY header or the call is rejected. Neither is
    # regenerated on reconnect - only by an explicit "Regenerate secret"
    # (see views.py).
    webhook_token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    webhook_secret = models.CharField(max_length=64, default=new_webhook_secret, editable=False)
    last_event_at = models.DateTimeField(null=True, blank=True)
    events_received_count = models.PositiveIntegerField(default=0)
    # The last few accepted bodies are kept (newest first) so the real shape
    # Leopards sends can be inspected.
    recent_webhook_payloads = models.JSONField(default=list, blank=True)
    # Why the latest call was turned away (missing/wrong header, not JSON),
    # shown on the integration page so a misconfigured registration is
    # obvious.
    last_webhook_error = models.CharField(max_length=255, blank=True, default="")
    last_webhook_error_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = f'"{SCHEMA}"."connections"'
        constraints = [
            models.UniqueConstraint(fields=["organization"], name="leopards_one_connection_per_org")
        ]

    def __str__(self):
        return f"Leopards ({self.organization_id})"


class LeopardsShipment(TenantScopedModel):
    """One Leopards consignment for one Order - lets every other piece of
    Leopards code (poller, cancel, airway bill, load sheet) find "is this
    order booked with Leopards" from a real row, never from the order's
    courier name alone (every org has a manual courier called "Leopards").
    Same role as PostExShipment."""

    order = models.ForeignKey("oms.Order", on_delete=models.CASCADE, related_name="leopards_shipments")
    # Our booked_packet_order_id on Leopards (the order number without '#',
    # or -R2... on a rebook after a cancel - see services._next_reference).
    reference = models.CharField(max_length=100)
    # Leopards' CN number ("track_number" in its API).
    tracking_number = models.CharField(max_length=100, blank=True, default="")
    # The URL Leopards answers a booking with - the airway bill / slip.
    slip_link = models.CharField(max_length=500, blank=True, default="")
    # The Leopards shipper (shipment_id) the parcel was booked under - set
    # only for bookings through FynkTech's account (OMS Courier).
    shipper_id = models.CharField(max_length=30, blank=True, default="")
    # Leopards' own status text/code as last reported ("Consignment
    # Booked", "DV", ...).
    status_label = models.CharField(max_length=100, blank=True, default="")
    status_history = models.JSONField(default=list, blank=True)
    last_payload = models.JSONField(default=dict, blank=True)

    # False once cancelled (locally or on Leopards) - a rebook then creates
    # a fresh active row and this one stays as history.
    is_active = models.BooleanField(default=True)
    booked_at = models.DateTimeField(auto_now_add=True)
    # Set when our "Print Leopards Load Sheet" generated Leopards' load
    # sheet for this parcel (the hand-over step).
    load_sheet_id = models.CharField(max_length=50, blank=True, default="")
    load_sheet_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    # Drives the poller's rotation.
    last_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = f'"{SCHEMA}"."shipments"'
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="leopards_reference_unique_per_org"
            ),
            models.UniqueConstraint(
                fields=["order"],
                condition=models.Q(is_active=True),
                name="leopards_one_active_shipment_per_order",
            ),
        ]
        indexes = [
            models.Index(
                fields=["organization", "is_active", "last_checked_at"], name="leopards_shipment_poll_idx"
            ),
            models.Index(fields=["organization", "tracking_number"], name="leopards_shipment_tn_idx"),
        ]

    def __str__(self):
        return f"Leopards shipment {self.reference} ({self.tracking_number or 'no CN yet'})"


class LeopardsSyncJob(TenantScopedModel):
    """One background Leopards status-sync run - mirror of PostExSyncJob so
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
