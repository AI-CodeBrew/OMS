import uuid

from django.db import models

from core.models import TenantScopedModel


class SmartlaneBusinessConfig(models.Model):
    """The OMS's own credentials as an onboarded Smartlane *business*.

    Platform-level on purpose - a plain Model, not TenantScopedModel. This
    belongs to the deployment, not to any org, and TenantManager would hide
    it from exactly the person who administers it (a super admin carries no
    organization_id). Effectively a singleton; load() is the only accessor.

    client_id/client_secret/jwt_token are stored plaintext, matching
    ShopifyConnection and SmartlaneConnection above - the same
    field-level-encryption caveat applies to all three.

    jwt_token is the HMAC key Smartlane call an "Auth token" (base64 of
    client_id:client_secret:ip). It is not fetched from /portal; they
    issue it and we paste it here. Calls fail with "Invalid Authentication
    Code" until this value and the PHP-style hex HMAC match.
    """

    SINGLETON_PK = 1

    id = models.PositiveSmallIntegerField(primary_key=True, default=SINGLETON_PK, editable=False)
    business_code = models.CharField(max_length=100, blank=True, default="")
    client_id = models.CharField(max_length=255, blank=True, default="")
    client_secret = models.CharField(max_length=255, blank=True, default="")
    jwt_token = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=False)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_verify_error = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"integrations"."smartlane_business_config"'

    def __str__(self):
        return f"Smartlane business {self.business_code or '(unconfigured)'}"

    @classmethod
    def load(cls):
        """The row, creating a blank one on first access so callers never
        have to handle None."""
        config, _ = cls.objects.get_or_create(pk=cls.SINGLETON_PK)
        return config

    @property
    def is_configured(self):
        return bool(self.business_code and self.jwt_token)


class SmartlaneCourierOffering(models.Model):
    """A courier the platform offers to organizations, e.g. "Smartlane - Trax".

    This catalog is ours, not Smartlane's: their Business API has no
    courier-list endpoint, so there is nothing to fetch. What it does have
    is warehouses, and the working theory (see the plan's open questions -
    unconfirmed with Smartlane) is that a warehouse is what binds a store's
    booking to a carrier. So each row here is really a warehouse template:
    approving an org for this offering means creating a warehouse for their
    store from these settings, and booking against that warehouse code is
    what selects the courier.

    Platform-level for the same reason as SmartlaneBusinessConfig - a super
    admin has no organization_id, so TenantManager would hide it from them.
    """

    SERVICE_TYPE_CHOICES = [
        ("overnight", "Overnight"),
        ("overland", "Overland"),
    ]

    id = models.BigAutoField(primary_key=True)
    # Write-once: org onboarding records reference offerings by key rather
    # than by FK, so renaming one after the fact would orphan them. The
    # update path ignores this field for that reason.
    key = models.SlugField(max_length=50, unique=True)
    # What tenants pick from, e.g. "Smartlane - Trax".
    label = models.CharField(max_length=100)
    # The carrier alone, e.g. "Trax" - what goes into the Smartlane-side
    # warehouse name. Kept separate from label because the two have
    # different audiences: rendering "{org} - {label}" would produce
    # "Fynk Tech - Smartlane - Trax", where the real warehouses on the
    # Smartlane portal are named like "Fynk Tech-Trax".
    carrier_name = models.CharField(max_length=100, blank=True, default="")
    service_type = models.CharField(
        max_length=20, choices=SERVICE_TYPE_CHOICES, default="overland"
    )
    # Rendered per org when the warehouse is created. Placeholders:
    # {org} and {carrier}.
    warehouse_name_template = models.CharField(
        max_length=150, blank=True, default="{org} - {carrier}"
    )
    auto_booking = models.BooleanField(default=True)
    notes = models.CharField(max_length=500, blank=True, default="")
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"integrations"."smartlane_courier_offerings"'
        ordering = ["sort_order", "label"]

    def __str__(self):
        return self.label

    def warehouse_name_for(self, organization_name):
        template = self.warehouse_name_template or "{org} - {carrier}"
        carrier = self.carrier_name or self.label
        return (
            template.replace("{org}", organization_name)
            .replace("{carrier}", carrier)
            .replace("{label}", self.label)
        )


class SmartlaneStoreLink(TenantScopedModel):
    """One organization's onboarding onto the platform's Smartlane business
    account, and the store it becomes.

    Two review gates in sequence, which is why there are more statuses than
    feels necessary. First the super admin approves the request internally
    (pending_approval -> in_review or rejected); only then is the KYC sent
    to Smartlane, who run their own review before the store goes live
    (in_review -> active). Nothing here books anything until active.

    Tenant-scoped so an org sees only its own request. The catalog it
    references (SmartlaneCourierOffering) is platform-level, hence keys in
    a JSON list rather than a many-to-many.
    """

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("pending_approval", "Pending approval"),
        ("rejected", "Rejected"),
        ("in_review", "In review with Smartlane"),
        ("active", "Active"),
        ("in_active", "Inactive"),
    ]
    # The three Smartlane itself reports back from GET /store.
    SMARTLANE_STATUSES = {"active", "in_active", "in_review"}

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")

    # --- KYC, in the order Smartlane's doc lists it ---
    kyc_name = models.CharField(max_length=255, blank=True, default="")
    kyc_logo_url = models.URLField(max_length=500, blank=True, default="")
    # Their doc: "shopify, wordpress, api - in case of business : Api".
    kyc_platform = models.CharField(max_length=50, blank=True, default="api")
    kyc_industry = models.CharField(max_length=150, blank=True, default="")
    kyc_ntn = models.CharField(max_length=50, blank=True, default="")
    kyc_years_in_business = models.PositiveSmallIntegerField(null=True, blank=True)
    kyc_business_address = models.CharField(max_length=500, blank=True, default="")
    # Not part of Smartlane's KYC field list - these two exist only for
    # provisioning a warehouse once the store goes active (their Add/Edit
    # Warehouse endpoint wants City and Zip code separately from the free
    # text KYC address). Kept on the link rather than the warehouse itself
    # so they only need collecting once per org.
    kyc_city = models.CharField(max_length=100, blank=True, default="")
    kyc_zip_code = models.CharField(max_length=20, blank=True, default="")
    kyc_avg_order_value = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    kyc_avg_monthly_sales = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    kyc_annual_retail_sales = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    kyc_poc_name = models.CharField(max_length=150, blank=True, default="")
    kyc_email = models.CharField(max_length=255, blank=True, default="")
    kyc_phone = models.CharField(max_length=50, blank=True, default="")

    # SmartlaneCourierOffering.key values - keys not FKs, so the catalog can
    # be reordered or pruned without rewriting requests. See that model's
    # note on why key is write-once.
    requested_offerings = models.JSONField(default=list, blank=True)

    smartlane_store_id = models.CharField(max_length=100, blank=True, default="")

    requested_by_user_id = models.UUIDField(null=True, blank=True)
    requested_at = models.DateTimeField(null=True, blank=True)
    reviewed_by_email = models.CharField(max_length=255, blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Rejection reason, shown to the org - the whole point of rejecting is
    # telling them what to fix.
    review_note = models.CharField(max_length=500, blank=True, default="")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # Whatever Smartlane's KYC call answered, kept verbatim for debugging.
    last_submit_response = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = '"integrations"."smartlane_store_links"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization"], name="integrations_one_smartlane_store_per_org"
            )
        ]

    def __str__(self):
        return f"Smartlane store link ({self.status})"

    @property
    def is_live(self):
        return self.status == "active" and bool(self.smartlane_store_id)


class SmartlaneStoreWarehouse(TenantScopedModel):
    """A warehouse Smartlane created for a store, one per requested courier
    offering - this is the row that actually binds a booking to a carrier
    (see SmartlaneCourierOffering.warehouse_name_for and the plan's open
    question this design rests on).

    Created automatically once a SmartlaneStoreLink goes active (see
    business_services.provision_warehouses) rather than by hand. Kept even
    if provisioning fails, with the error recorded, so the admin page can
    show what needs retrying instead of silently having nothing.
    """

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("active", "Active"),
        ("failed", "Failed"),
        ("revoked", "Revoked"),
    ]

    store_link = models.ForeignKey(
        SmartlaneStoreLink, on_delete=models.CASCADE, related_name="warehouses"
    )
    offering = models.ForeignKey(
        SmartlaneCourierOffering, on_delete=models.PROTECT, related_name="+"
    )
    smartlane_warehouse_code = models.CharField(max_length=100, blank=True, default="")
    name = models.CharField(max_length=150, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_provision_error = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        db_table = '"integrations"."smartlane_store_warehouses"'
        constraints = [
            models.UniqueConstraint(
                fields=["store_link", "offering"],
                name="integrations_one_warehouse_per_store_offering",
            )
        ]

    def __str__(self):
        return f"{self.name or self.offering_id} ({self.status})"


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
    """One Smartlane courier account per organization. api_key books
    consignments and fetches tracking/documents (outbound); separately,
    Smartlane can also call our webhook to report shipment status changes -
    that side is push, this side is pull, they don't depend on each other."""

    api_key = models.CharField(max_length=255, blank=True, default="")
    # From Smartlane's Store > Warehouse section (or the warehouse/list
    # api) - required on every booking call, consignments must belong to
    # this warehouse.
    store_warehouse_code = models.CharField(max_length=100, blank=True, default="")
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
