import uuid

from django.db import models

from .context import current_is_super_admin, current_organization_id


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"core"."organizations"'

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
