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


def _emails_for_user_ids(user_ids):
    """Resolve Auth emails for many user ids with bounded concurrency.

    Avoids the old sequential N+1 (one HTTP round-trip per membership), which
    made the super-admin list feel slower than heavy tenant order pages.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    unique = []
    seen = set()
    for uid in user_ids:
        key = str(uid)
        if key and key not in seen:
            seen.add(key)
            unique.append(key)
    if not unique:
        return {}

    def fetch(uid):
        try:
            user = supabase_admin.get_user(uid)
            return uid, (user or {}).get("email")
        except SupabaseAdminError:
            return uid, None

    emails = {}
    workers = min(8, len(unique))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetch, uid) for uid in unique]
        for fut in as_completed(futures):
            uid, email = fut.result()
            emails[uid] = email
    return emails


def _members_payload(memberships, email_map=None):
    email_map = email_map or {}
    members = []
    for membership in memberships:
        uid = str(membership.user_id)
        members.append(
            {
                "user_id": uid,
                "email": email_map.get(uid),
                "role": membership.role,
                "allowed_modules": list(membership.allowed_modules or []),
                "created_at": membership.created_at.isoformat(),
            }
        )
    return members


def list_organizations(*, include_emails=False):
    """List orgs from Postgres. Emails are optional (extra Auth Admin calls).

    Org list UI only needs member counts — keep include_emails=False there.
    Users tab should pass include_emails=True.
    """
    orgs = Organization.objects.prefetch_related("memberships", "modules").order_by(
        "-created_at"
    )
    email_map = {}
    if include_emails:
        user_ids = [
            membership.user_id
            for org in orgs
            for membership in org.memberships.all()
        ]
        email_map = _emails_for_user_ids(user_ids)

    results = []
    for org in orgs:
        memberships = list(org.memberships.all())
        members = _members_payload(
            memberships, email_map if include_emails else None
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

    memberships = list(org.memberships.all())
    email_map = _emails_for_user_ids([m.user_id for m in memberships])
    return _serialize_org(org, _members_payload(memberships, email_map))


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
                "modules": module_list,
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
        allowed_modules=module_list,
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
    shopify = None
    try:
        from integrations.models import ShopifyConnection

        conn = (
            ShopifyConnection.all_objects.filter(organization_id=org.id)
            .order_by("-updated_at")
            .first()
        )
        if conn:
            shopify = {
                "shop_domain": conn.shop_domain,
                "shop_name": conn.shop_name,
                "is_connected": conn.is_connected,
                "last_synced_at": (
                    conn.last_synced_at.isoformat() if conn.last_synced_at else None
                ),
            }
    except Exception:
        shopify = None

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
        "shopify": shopify,
    }
