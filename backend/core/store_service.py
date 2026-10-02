"""One login, many stores: listing the stores an org-admin belongs to,
creating an additional store under the same login, and switching the
active store by rewriting the Supabase JWT's org claims.

Deliberately separate from organization_admin_service (the super-admin
"create an organization with a brand new admin login" path) - this one
never creates a Supabase user, it attaches a new Organization to the
*caller's own* user_id instead.
"""

import logging

from django.db import transaction
from django.utils.text import slugify

from . import supabase_admin
from .models import Membership, Organization, OrganizationModule
from .rbac import write_audit_log
from .supabase_admin import SupabaseAdminError

logger = logging.getLogger(__name__)


class StoreAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _unique_slug(name):
    base = slugify(name) or "store"
    slug = base
    suffix = 1
    while Organization.objects.filter(slug=slug).exists():
        suffix += 1
        slug = f"{base}-{suffix}"
    return slug


def list_my_stores(user_id, current_organization_id):
    """Every store this login has a Membership in, current store first."""
    memberships = (
        Membership.objects.filter(user_id=user_id)
        .select_related("organization")
        .order_by("organization__name")
    )
    stores = []
    for membership in memberships:
        org = membership.organization
        stores.append(
            {
                "id": str(org.id),
                "name": org.name,
                "is_manual_store": org.is_manual_store,
                "is_active": org.is_active,
                "role": membership.role,
                "is_current": str(org.id) == str(current_organization_id),
            }
        )
    stores.sort(key=lambda s: (not s["is_current"], s["name"].lower()))
    return stores


@transaction.atomic
def create_store(*, user_id, source_organization_id, name, is_manual_store=False):
    """Adds a new store to the caller's login - copies the calling store's
    plan and enabled modules so the new store behaves the same way (same
    OMS/WMS entitlements) until the super admin says otherwise. The caller
    becomes that store's org_admin."""
    name = (name or "").strip()
    if not name:
        raise StoreAdminError("Store name is required")

    try:
        source_org = Organization.objects.get(id=source_organization_id)
    except Organization.DoesNotExist as exc:
        raise StoreAdminError("Current organization not found", 404) from exc

    organization = Organization.objects.create(
        name=name,
        slug=_unique_slug(name),
        plan=source_org.plan,
        is_active=True,
        is_manual_store=bool(is_manual_store),
    )

    module_names = list(
        OrganizationModule.objects.filter(
            organization_id=source_org.id, is_enabled=True
        ).values_list("module", flat=True)
    ) or ["oms"]
    for module in module_names:
        OrganizationModule.objects.create(
            organization=organization, module=module, is_enabled=True
        )

    Membership.objects.create(
        organization=organization,
        user_id=user_id,
        role="org_admin",
        allowed_modules=module_names,
    )

    write_audit_log(
        organization_id=organization.id,
        action="store_created",
        summary=f"Store '{organization.name}' created"
        + (" (manual)" if organization.is_manual_store else ""),
        actor_user_id=user_id,
    )

    return {
        "id": str(organization.id),
        "name": organization.name,
        "is_manual_store": organization.is_manual_store,
        "is_active": organization.is_active,
        "role": "org_admin",
        "is_current": False,
    }


def switch_store(*, user_id, organization_id, actor_email=""):
    """Points this login's JWT at `organization_id` - the caller must
    already have a Membership there. Returns nothing: the frontend gets a
    fresh session (and therefore fresh app_metadata) by calling Supabase's
    own refreshSession() right after this succeeds."""
    try:
        membership = Membership.objects.get(user_id=user_id, organization_id=organization_id)
    except Membership.DoesNotExist as exc:
        raise StoreAdminError("You don't have access to that store", 403) from exc

    try:
        organization = Organization.objects.get(id=organization_id)
    except Organization.DoesNotExist as exc:
        raise StoreAdminError("Store not found", 404) from exc

    if not organization.is_active:
        raise StoreAdminError("That store is suspended", 403)

    try:
        supabase_admin.set_org_claims(
            user_id, organization, membership.role, membership.allowed_modules
        )
    except SupabaseAdminError as exc:
        raise StoreAdminError(exc.message, exc.status_code) from exc

    write_audit_log(
        organization_id=organization.id,
        action="store_switched",
        summary=f"Switched into store '{organization.name}'",
        actor_user_id=user_id,
        actor_email=actor_email,
    )
