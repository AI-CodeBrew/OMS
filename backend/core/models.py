import uuid

from django.db import models

from .context import current_is_super_admin, current_organization_id, current_organization_ids


class TenantManager(models.Manager):
    """Default manager for TenantScopedModel subclasses. Filters every read
    by the organization resolved for the current request, and fails
    closed (returns nothing) when there's no tenant context at all - e.g.
    a shell or one-off script that never went through TenantMiddleware.
    Use `all_objects` there instead of loosening this default."""

    def get_queryset(self):
        qs = super().get_queryset()
        if current_is_super_admin.get():
            return qs
        organization_ids = current_organization_ids.get()
        if organization_ids:
            return qs.filter(organization_id__in=organization_ids)
        organization_id = current_organization_id.get()
        if organization_id is None:
            return qs.none()
        return qs.filter(organization_id=organization_id)


class TenantScopedModel(models.Model):
    """Base class for every business model. Every table gets an
    organization_id FK to core.Organization plus a manager that scopes
    reads to the current tenant by default, so a forgotten filter() in a
    view can't leak another organization's rows."""

    organization = models.ForeignKey(
        "core.Organization", on_delete=models.CASCADE, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = TenantManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True


class Organization(models.Model):
    PLAN_CHOICES = [
        ("free", "Free"),
        ("starter", "Starter"),
        ("growth", "Growth"),
        ("enterprise", "Enterprise"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default="free")
    is_active = models.BooleanField(default=True)
    # True for a store created from the tenant side purely to hold CSV-
    # imported orders (Settings > Stores > "Create manual store") - no
    # Shopify/courier connections expected, orders arrive via
    # oms.order_importer instead. Lets the frontend decide which store
    # switcher entries show "Import orders" vs the usual integration cards.
    is_manual_store = models.BooleanField(default=False)
    # True for the one hidden organization that holds FynkTech's own courier
    # accounts (the super admin's "OMS Courier" tab - see core.
    # platform_service). Reusing a real org lets those accounts live in the
    # same tenant-scoped connection tables and be managed through the same
    # integration screens a store admin uses. Never listed as a store.
    is_platform = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"core"."organizations"'
        constraints = [
            models.UniqueConstraint(
                fields=["is_platform"],
                condition=models.Q(is_platform=True),
                name="core_one_platform_organization",
            )
        ]

    def __str__(self):
        return self.name


class Membership(models.Model):
    ROLE_CHOICES = [
        ("org_admin", "Org Admin"),
        ("org_user", "Org User"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    # Supabase auth.users.id - deliberately not a Django FK. Tenant users
    # are managed by Supabase Auth, not Django's own auth system.
    user_id = models.UUIDField()
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="org_user")
    # For org_user: exactly one of oms|wms|finance. Org admin may store all
    # enabled modules or leave empty (treated as full access at runtime).
    allowed_modules = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"core"."memberships"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user_id"], name="core_membership_unique_user_per_org"
            )
        ]

    def __str__(self):
        return f"{self.user_id} @ {self.organization_id} ({self.role})"


class OrganizationModule(models.Model):
    MODULE_CHOICES = [
        ("oms", "OMS"),
        ("wms", "WMS"),
        ("finance", "Finance"),
    ]

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="modules"
    )
    module = models.CharField(max_length=20, choices=MODULE_CHOICES)
    is_enabled = models.BooleanField(default=False)

    class Meta:
        db_table = '"core"."organization_modules"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "module"], name="core_org_module_unique"
            )
        ]

    def __str__(self):
        return f"{self.organization_id}:{self.module}={'on' if self.is_enabled else 'off'}"


class OrganizationAuditLog(TenantScopedModel):
    """Org-wide activity log for the org admin Logs tab and, across every
    store, the super admin's Logs tab (core.activity_log_service)."""

    ROLE_STORE_ADMIN = "store_admin"
    ROLE_STORE_USER = "store_user"
    ROLE_SUPER_ADMIN = "super_admin"
    ROLE_SYSTEM = "system"
    ROLE_CHOICES = [
        (ROLE_STORE_ADMIN, "Store admin"),
        (ROLE_STORE_USER, "Store user"),
        (ROLE_SUPER_ADMIN, "FynkTech"),
        (ROLE_SYSTEM, "System"),
    ]

    # Null for something the super admin did on the platform itself (e.g. on
    # the Tickets or Invoices tab) that names no store - only the super
    # admin's Logs tab shows those; TenantManager never matches them.
    organization = models.ForeignKey(
        "core.Organization", on_delete=models.CASCADE, related_name="+", null=True, blank=True
    )
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_user_id = models.UUIDField(null=True, blank=True)
    actor_email = models.CharField(max_length=255, blank=True, default="")
    actor_role = models.CharField(max_length=20, choices=ROLE_CHOICES, blank=True, default="")
    action = models.CharField(max_length=64)
    # orders|wms|integrations|team|finance|support|store|other - see
    # activity_log_service.category_for.
    category = models.CharField(max_length=20, blank=True, default="")
    entity_type = models.CharField(max_length=64, blank=True, default="")
    entity_id = models.CharField(max_length=64, blank=True, default="")
    summary = models.CharField(max_length=500)
    metadata = models.JSONField(default=dict, blank=True)
    # Where it came from - the request that caused it, when there was one.
    ip_address = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=300, blank=True, default="")
    request_method = models.CharField(max_length=8, blank=True, default="")
    request_path = models.CharField(max_length=255, blank=True, default="")
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        db_table = '"core"."organization_audit_logs"'
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "-created_at"], name="core_audit_org_created"),
            models.Index(fields=["-created_at"], name="core_audit_created"),
        ]

    def __str__(self):
        return f"{self.action} @ {self.organization_id}"


class DispatchHubStore(models.Model):
    """Stores the super admin has pulled into the Dispatch Hub - operated
    together as one multi-store Orders/Batch/Dashboard/Returns/Reports view
    (see middleware.py's X-Dispatch-Hub handling). Platform-level config
    about which orgs are in the Hub, not tenant business data - plain
    Manager, never filtered by TenantManager, same reasoning as
    Organization/Membership above."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.OneToOneField(
        Organization, on_delete=models.CASCADE, related_name="dispatch_hub_entry"
    )
    # What FynkTech bills this store per dispatched order - the default an
    # invoice draft starts from (see finance.Invoice in a later phase),
    # editable per invoice afterwards.
    per_order_rate = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    added_by = models.UUIDField(null=True, blank=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"core"."dispatch_hub_stores"'
        ordering = ["organization__name"]

    def __str__(self):
        return f"Dispatch Hub: {self.organization_id}"


class Notification(TenantScopedModel):
    """A message for a store's own users, under the bell in its header -
    FynkTech's super admin changing one of the store's orders (see
    oms.views.OrderViewSet.update) or answering/editing its OMS Courier
    request, so the store knows what changed. No FK to the order (core
    doesn't import oms) - its id and number are kept instead."""

    KIND_ORDER_EDITED = "order_edited"
    # The super admin editing, approving or rejecting the store's OMS
    # Courier request (integrations.oms_courier_service).
    KIND_COURIER_REQUEST = "oms_courier_request"
    KIND_CHOICES = [
        (KIND_ORDER_EDITED, "Order edited by FynkTech"),
        (KIND_COURIER_REQUEST, "OMS Courier request updated by FynkTech"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    title = models.CharField(max_length=255)
    message = models.CharField(max_length=1000, blank=True, default="")
    order_id = models.UUIDField(null=True, blank=True)
    order_number = models.CharField(max_length=100, blank=True, default="")
    # [{"field", "label", "old", "new"}] - every value as shown, before/after.
    changes = models.JSONField(default=list, blank=True)
    actor_email = models.CharField(max_length=255, blank=True, default="")
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = '"core"."notifications"'
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["organization", "-created_at"], name="core_notification_org_idx")]

    def __str__(self):
        return f"{self.kind} ({self.organization_id})"
