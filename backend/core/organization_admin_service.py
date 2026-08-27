from django.db import transaction
from django.utils.text import slugify

from . import supabase_admin
from .models import Membership, Organization, OrganizationModule
from .supabase_admin import SupabaseAdminError


class OrganizationAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def list_organizations():
    orgs = Organization.objects.prefetch_related("memberships", "modules").order_by("-created_at")
    results = []
    for org in orgs:
        members = []
        for membership in org.memberships.all():
            email = None
            try:
                user = supabase_admin.get_user(str(membership.user_id))
                if user:
                    email = user.get("email")
            except SupabaseAdminError:
                email = None
            members.append(
                {
                    "user_id": str(membership.user_id),
                    "email": email,
                    "role": membership.role,
                    "created_at": membership.created_at.isoformat(),
                }
            )
        results.append(_serialize_org(org, members))
    return results


def get_organization(organization_id):
    try:
        org = Organization.objects.prefetch_related("memberships", "modules").get(
            id=organization_id
        )
    except Organization.DoesNotExist as exc:
        raise OrganizationAdminError("Organization not found", 404) from exc

    members = []
    for membership in org.memberships.all():
        email = None
        try:
            user = supabase_admin.get_user(str(membership.user_id))
            if user:
                email = user.get("email")
        except SupabaseAdminError:
            email = None
        members.append(
            {
                "user_id": str(membership.user_id),
                "email": email,
                "role": membership.role,
                "created_at": membership.created_at.isoformat(),
            }
        )
    return _serialize_org(org, members)


@transaction.atomic
def create_organization_with_admin(
    *,
    name,
    email,
    password,
    plan="starter",
    slug=None,
    modules=None,
):
    name = (name or "").strip()
    email = (email or "").strip().lower()
    password = password or ""
    if not name:
        raise OrganizationAdminError("Organization name is required")
    if not email:
        raise OrganizationAdminError("Admin email is required")
    if len(password) < 8:
        raise OrganizationAdminError("Password must be at least 8 characters")

    org_slug = slugify(slug or name)
    if not org_slug:
        raise OrganizationAdminError("Could not derive a valid slug from the name")
    if Organization.objects.filter(slug=org_slug).exists():
        raise OrganizationAdminError(f"Organization slug '{org_slug}' already exists")

    module_list = modules or ["oms", "wms"]
    module_list = [m.strip() for m in module_list if m and m.strip()]

    organization = Organization.objects.create(
        name=name,
        slug=org_slug,
        plan=plan or "starter",
        is_active=True,
    )

    for module in module_list:
        OrganizationModule.objects.create(
            organization=organization,
            module=module,
            is_enabled=True,
        )

    try:
        user = supabase_admin.create_user(
            email=email,
            password=password,
            app_metadata={
                "organization_id": str(organization.id),
                "organization_name": organization.name,
                "role": "org_admin",
            },
        )
    except SupabaseAdminError as exc:
        raise OrganizationAdminError(exc.message, exc.status_code) from exc

    user_id = user.get("id")
    if not user_id:
        raise OrganizationAdminError("Supabase did not return a user id", 500)

    Membership.objects.create(
        organization=organization,
        user_id=user_id,
        role="org_admin",
    )

    return get_organization(organization.id)


def update_member_credentials(user_id, *, email=None, password=None):
    if email is None and password is None:
        raise OrganizationAdminError("Provide email and/or password to update")
    if password is not None and len(password) < 8:
        raise OrganizationAdminError("Password must be at least 8 characters")
    if email is not None:
        email = email.strip().lower()
        if not email:
            raise OrganizationAdminError("Email cannot be empty")

    membership = Membership.objects.select_related("organization").filter(user_id=user_id).first()
    if not membership:
        raise OrganizationAdminError("User is not linked to any organization", 404)

    try:
        user = supabase_admin.update_user(
            str(user_id),
            email=email,
            password=password,
        )
    except SupabaseAdminError as exc:
        raise OrganizationAdminError(exc.message, exc.status_code) from exc

    return {
        "user_id": str(user_id),
        "email": user.get("email") or email,
        "organization_id": str(membership.organization_id),
        "organization_name": membership.organization.name,
        "role": membership.role,
        "updated": {
            "email": email is not None,
            "password": password is not None,
        },
    }


def _serialize_org(org, members):
    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "plan": org.plan,
        "is_active": org.is_active,
        "created_at": org.created_at.isoformat(),
        "modules": [
            {"module": m.module, "is_enabled": m.is_enabled} for m in org.modules.all()
        ],
        "members": members,
    }
