import uuid

from django.db import models

from core.models import TenantScopedModel


class ShopifyConnection(TenantScopedModel):
    """One Shopify store per organization. access_token/webhook_secret are
    stored plaintext for now, matching the legacy public.shopify_integrations
    table this replaces - worth hardening (field-level encryption) before
    onboarding real external tenants, same caveat as that legacy table."""

    shop_domain = models.CharField(max_length=255, unique=True)
    shop_name = models.CharField(max_length=255, blank=True, default="")
    access_token = models.CharField(max_length=255)
    webhook_secret = models.CharField(max_length=255)
    currency = models.CharField(max_length=10, blank=True, default="")
    is_connected = models.BooleanField(default=False)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # Toggle from the integrations page - lets a tenant pause writes from
    # both the manual "Sync now" and the order webhook without disconnecting
    # (which would drop credentials/webhook registrations entirely).
    auto_sync_orders = models.BooleanField(default=True)
    # True once webhooks are successfully registered - toggleable from the
    # integrations page (see ShopifyConnectionView.patch), which calls
    # register/unregister_webhook against the ids stored below.
    webhooks_active = models.BooleanField(default=False)
    # Shopify webhook ids from the last successful registration, so they
    # can actually be unregistered again when the user turns this off -
    # without this there'd be no way to find them to delete.
    webhook_ids = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = '"integrations"."shopify_connections"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization"], name="integrations_one_shopify_connection_per_org"
            )
        ]

    def __str__(self):
        return self.shop_domain


class SmartlaneConnection(TenantScopedModel):
    """One Smartlane courier account per organization. Unlike Shopify
    (which we pull orders FROM), Smartlane is a push integration - it
    calls our webhook to report shipment status changes (picked,
    in-transit, delivered, returned) for orders booked through it, and
    api_key is kept for the future outbound side (creating bookings/rate
    lookups), not used by the webhook receiver itself."""

    api_key = models.CharField(max_length=255, blank=True, default="")
    webhook_secret = models.CharField(max_length=255)
    # Identifies which org a webhook POST belongs to (embedded in the
    # callback URL registered with Smartlane) - Smartlane has no
    # per-request "account domain" header the way Shopify does, so this
    # plays that role instead. Never regenerated after connect, so the
    # registered callback URL keeps working across reconnects/edits.
    webhook_token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    is_connected = models.BooleanField(default=False)
    webhooks_active = models.BooleanField(default=False)
    last_event_at = models.DateTimeField(null=True, blank=True)
    events_received_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = '"integrations"."smartlane_connections"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization"], name="integrations_one_smartlane_connection_per_org"
            )
        ]

    def __str__(self):
        return f"Smartlane ({self.organization_id})"


class ShopifySyncJob(TenantScopedModel):
    """Tracks one background order-sync run. No FK back to a specific
    ShopifyConnection - there's only ever one per org, and only the most
    recent job is ever read (no job-history UI)."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]
    MODE_CHOICES = [
        ("full", "Full"),
        ("incremental", "Incremental"),
        ("custom", "Custom Range"),
        ("backfill", "Gap Backfill"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    mode = models.CharField(max_length=15, choices=MODE_CHOICES)
    # Cooperative cancellation - the running thread checks this after each
    # page and stops itself if set, rather than anything actually killing
    # the thread. Also lets the cancel endpoint give instant UI feedback
    # (it flips `status` to "cancelled" directly too) even for a job whose
    # thread has already died - e.g. a runserver auto-reload mid-sync,
    # which otherwise leaves the row stuck at "running" forever with
    # nothing left able to update it.
    cancel_requested = models.BooleanField(default=False)
    # Only set for mode="custom" - the requested bounds, for display
    # ("Custom: Jul 1 - Jul 31") rather than a real query filter.
    range_from = models.DateField(null=True, blank=True)
    range_to = models.DateField(null=True, blank=True)
    # mode="backfill": a list of {"from": "YYYY-MM-DD", "to": "..."} windows
    # fetched one after another in a single job. Gap backfills are usually
    # several disconnected stretches (a fortnight in June, a day in March),
    # and syncing one span covering all of them would re-pull every
    # complete month in between - the whole point is to fetch only what's
    # actually missing.
    ranges = models.JSONField(default=list, blank=True)
    pages_fetched = models.PositiveIntegerField(default=0)
    total_fetched = models.PositiveIntegerField(default=0)
    created_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    # Orders that raised an error during upsert (bad/unexpected data) are
    # counted here and skipped rather than aborting the whole sync - see
    # run_shopify_sync. error_message holds the most recent skip reason,
    # not a job-level failure, when skipped_count > 0 but status still
    # reaches "completed".
    skipped_count = models.PositiveIntegerField(default=0)
    # Total orders matching this sync's filters, per Shopify's own count
    # endpoint - fetched once at start so progress can show "X of Y
    # fetched, Z remaining" instead of just a running total.
    total_available = models.PositiveIntegerField(null=True, blank=True)
    # created_at of the last order actually written, updated as the sync
    # progresses (same cadence as the other counters). If this job dies
    # mid-run (e.g. a server restart kills the background thread), the next
    # sync resumes from here via created_at_min instead of restarting from
    # page 1 - see views.ShopifySyncView.post and get.
    resume_cursor = models.DateTimeField(null=True, blank=True)
    error_message = models.CharField(max_length=500, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = '"integrations"."shopify_sync_jobs"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.mode} sync ({self.status})"
