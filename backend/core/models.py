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
    """Org-wide activity log for the org admin Logs tab."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_user_id = models.UUIDField(null=True, blank=True)
    actor_email = models.CharField(max_length=255, blank=True, default="")
    action = models.CharField(max_length=64)
    entity_type = models.CharField(max_length=64, blank=True, default="")
    entity_id = models.CharField(max_length=64, blank=True, default="")
    summary = models.CharField(max_length=500)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = '"core"."organization_audit_logs"'
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "-created_at"], name="core_audit_org_created"),
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
